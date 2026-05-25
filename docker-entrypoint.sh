#!/bin/sh
set -e

if [ "$(id -u)" = "0" ]; then
  # Running as root (legacy or explicit override): fix bind-mount ownership then drop.
  mkdir -p /app/public/previews /app/public/medium
  chown node:node /app/public/previews /app/public/medium
  exec su-exec node "$@"
fi

# Already running as the node user (USER node from image + no user: override).
exec "$@"
