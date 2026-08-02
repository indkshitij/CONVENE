# TrustSafety module

PRD §17.2 Module Responsibilities.

**Owns:** reports, moderation_actions, reputation_scores, audit_logs

**Publishes:** `moderation.actioned`, `reputation.recomputed`

**Consumes:** `message.sent`, `connection.requested`
