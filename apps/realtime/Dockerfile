# PRD §21.6 — multi-stage build, distroless, nonroot, healthcheck. Same
# shape as apps/api/Dockerfile since both are Node/NestJS services with
# the same deployment posture; §17.5's "any replica can serve any user"
# is exactly why this image has no local state baked in.
# Build context is the repo root: docker build -f apps/realtime/Dockerfile .
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/realtime/package.json ./apps/realtime/
RUN pnpm install --frozen-lockfile --filter @convene/realtime...

FROM deps AS build
COPY . .
RUN pnpm turbo run build --filter=@convene/realtime
RUN pnpm prune --prod

FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/realtime/dist ./dist
COPY --from=build /app/packages ./packages
USER nonroot
EXPOSE 8081
HEALTHCHECK CMD ["/nodejs/bin/node", "dist/healthcheck.js"]
CMD ["dist/main.js"]
