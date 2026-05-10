#!/bin/sh
set -e
# Bind-mounted volumes may be created by Docker as root.
# Fix ownership so the node user can write previews and medium files.
mkdir -p /app/public/previews /app/public/medium
chown node:node /app/public/previews /app/public/medium
exec su-exec node "$@"
