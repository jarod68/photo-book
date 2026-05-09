#!/usr/bin/env bash
# deploy-local.sh — Run photo-book locally (no Traefik, app on port 3000)
# Usage: ./deploy-local.sh [up|down|logs|build]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CMD="${1:-up}"
DC="docker compose -f docker-compose.yml -f docker-compose.local.yml"

# Generate .env if missing
if [[ ! -f .env ]]; then
  echo "POSTGRES_PASSWORD=localdev" > .env
  echo "[INFO] .env created with default password."
fi

# Ensure required dirs exist
mkdir -p photos public/previews public/medium letsencrypt
touch letsencrypt/acme.json

case "$CMD" in
  up)
    $DC up --build "$@" ;;
  down)
    $DC down ;;
  logs)
    $DC logs -f ;;
  build)
    $DC build ;;
  *)
    echo "Usage: $0 [up|down|logs|build]"
    exit 1 ;;
esac
