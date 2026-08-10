# Runbook: Database restore drill

**Cadence (§21.10)**: exercised twice a year as part of a game day.
**Pass criterion (§21.9)**: "quarterly restore drills that are only
considered passed when a full restore is verified within the 60-minute
RTO" (RPO 5 min per NFR-A-005/006 — continuous WAL archiving, PITR to any
second in the last 7 days, nightly full backups retained 30 days, weekly
retained 12 weeks, cross-region replicated and encrypted).

## What exists today

Confirmed by repo-wide search: **no backup or restore tooling exists
anywhere in this codebase** — no WAL-archiving configuration, no backup
script, no restore script, nothing under `scripts/` or `packages/db/`
implementing any part of the §21.9 backup policy. This is squarely a managed-
provider/infrastructure concern (the PRD's own tooling table names a managed
Postgres provider for "AES-256 volume + encrypted backups"), consistent with
this repo's established pattern of not including Terraform/K8s/infra-provider
config — but it means there is currently **nothing in this repository this
drill could exercise**, only a real managed-database provider's own backup
system, whichever one is eventually chosen for a real deployment.

## The intended procedure (to run once a real environment exists)

1. **Trigger**: either a scheduled quarterly drill, or this game day's own
   exercise.
2. **Select a restore point**: pick a timestamp within the last 7 days (PITR
   window) or the most recent nightly/weekly backup, deliberately not the
   most recent possible point — a drill should prove recovery to an
   _arbitrary_ point, not just "restore the latest backup," since a real
   incident (e.g., a bad migration, a data-corrupting bug) needs recovery to
   a point _before_ the damage, not the latest state.
3. **Restore into an isolated environment** — never restore over the live
   database. A separate instance/project, torn down after the drill.
4. **Start the clock** the moment the restore begins.
5. **Verify data integrity** post-restore: row counts on a few key tables
   (`users`, `messages`, `connections`) against expected values for the
   chosen restore point; spot-check a known record.
6. **Stop the clock** once the restored database is confirmed queryable and
   correct. **This elapsed time must be under 60 minutes for the drill to
   pass** — if it isn't, that's the headline finding, not a footnote.
7. **Record the result**: pass/fail, elapsed time, any manual steps that
   had to happen outside an automated restore procedure (each one is a
   future automation candidate — a drill that "passes" only because an
   engineer manually patched something mid-restore is a fragile pass, worth
   noting even if the clock came in under 60 minutes).
8. **Tear down** the isolated restore environment.

## What this pass actually did

Documented the procedure above (real, ready to run) and confirmed the
starting-point gap (no backup automation exists in-repo yet to restore
_from_). **Did not execute a restore** — no live Postgres instance with real
WAL archiving/backups exists in this sandbox to restore. This is the single
most consequential unexecuted item in the whole P29.4 pass: §21.9 and
§22.12 both treat a _verified_ restore-inside-RTO as a hard release gate,
and that verification has not happened.
