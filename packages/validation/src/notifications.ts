import { z } from "zod";

// PRD §10.8.3: "POST /notifications/read { ids:[...] } | { all: true }."
// Exactly one of the two shapes, never both/neither.
export const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.string()).optional(),
    all: z.boolean().optional(),
  })
  .refine((body) => (body.all === true) !== (body.ids !== undefined && body.ids.length > 0), {
    message: "Provide either { ids: [...] } or { all: true }, not both or neither",
  });

const channelPrefsSchema = z.object({
  push: z.boolean().optional(),
  in_app: z.boolean().optional(),
  email: z.boolean().optional(),
});

// PRD §10.8.3: "PUT /notifications/preferences { categories: { <category>:
// { push, in_app, email } }, quiet_hours: { enabled, start, end } }."
// Category keys aren't validated against the catalogue here (that set
// lives in apps/api's notification-catalogue.ts, not this framework-
// agnostic package) — an unknown category key is rejected by the service,
// same division of labour as messaging's own schemas.
export const updateNotificationPreferencesSchema = z.object({
  categories: z.record(z.string(), channelPrefsSchema).optional(),
  quiet_hours: z
    .object({
      enabled: z.boolean(),
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "start must be HH:mm"),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "end must be HH:mm"),
    })
    .optional(),
});

// PRD §10.8.3: "POST /devices { platform, push_token, app_version }."
export const DEVICE_PLATFORMS = ["ios", "android", "web"] as const;
export const registerDeviceSchema = z.object({
  platform: z.enum(DEVICE_PLATFORMS),
  push_token: z.string().min(1),
  app_version: z.string().nullable().optional(),
});
