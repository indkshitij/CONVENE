# PRD §21.6 — multi-stage build, distroless, nonroot, healthcheck.
# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --filter @convene/api...

FROM deps AS build
COPY . .
RUN pnpm turbo run build --filter=@convene/api
RUN pnpm prune --prod

FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/packages ./packages
USER nonroot
EXPOSE 8080
HEALTHCHECK CMD ["/nodejs/bin/node", "dist/healthcheck.js"]
CMD ["dist/main.js"]
