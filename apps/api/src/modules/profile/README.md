# Profile module

PRD §17.2 Module Responsibilities.

**Owns:** profiles and all child tables, completion, verification ladder

**Publishes:** `profile.updated`, `profile.location_changed`, `verification.upgraded`

**Consumes:** `user.registered`
