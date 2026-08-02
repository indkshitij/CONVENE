# Matching module

PRD §17.2 Module Responsibilities.

**Owns:** match_candidates, feed_impressions, suppressions, ranking

**Publishes:** `match.impression`, `match.skipped`

**Consumes:** `profile.updated`, `intent.changed`, `availability.*`
