#!/usr/bin/env bash
# Tears the local stack down, including its volumes, and brings it back up
# clean — used when a developer's local data has drifted and they want a
# pristine environment rather than a manual `docker compose down -v`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE=(docker compose)

echo "Stopping stack and removing volumes..."
"${COMPOSE[@]}" down -v

echo "Bringing up a pristine stack..."
exec "$(dirname "${BASH_SOURCE[0]}")/dev-up.sh"
