#!/usr/bin/env bash
# Brings up the local backing services (PRD §21.5) and waits for every one of
# them to report healthy before printing a readiness summary. Exits non-zero
# on timeout so it's safe to use as a CI/dev precondition, not just a human
# convenience script.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE=(docker compose)
SERVICES=(postgres redis minio mailpit)
TIMEOUT_SECONDS=60
POLL_INTERVAL=2

"${COMPOSE[@]}" up -d --build

start_time=$(date +%s)

service_status() {
  "${COMPOSE[@]}" ps --format json "$1" 2>/dev/null \
    | python3 -c 'import json,sys; lines=[l for l in sys.stdin if l.strip()]; print(json.loads(lines[0]).get("Health","") if lines else "")' 2>/dev/null || true
}

echo "Waiting for services to become healthy (timeout ${TIMEOUT_SECONDS}s)..."

while true; do
  all_healthy=true
  for service in "${SERVICES[@]}"; do
    status=$(service_status "$service")
    if [ "$status" != "healthy" ]; then
      all_healthy=false
    fi
  done

  if [ "$all_healthy" = true ]; then
    break
  fi

  now=$(date +%s)
  elapsed=$((now - start_time))
  if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
    echo "Timed out after ${TIMEOUT_SECONDS}s waiting for services to become healthy." >&2
    "${COMPOSE[@]}" ps
    exit 1
  fi

  sleep "$POLL_INTERVAL"
done

elapsed=$(( $(date +%s) - start_time ))

echo ""
echo "Readiness summary (${elapsed}s):"
for service in "${SERVICES[@]}"; do
  echo "  - ${service}: healthy"
done
echo ""
echo "Postgres  -> localhost:${POSTGRES_PORT:-5432}"
echo "Redis     -> localhost:${REDIS_PORT:-6379}"
echo "MinIO API -> localhost:${MINIO_API_PORT:-9000} (console: localhost:${MINIO_CONSOLE_PORT:-9001})"
echo "Mailpit   -> localhost:${MAILPIT_UI_PORT:-8025}"
