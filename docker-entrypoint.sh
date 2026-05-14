#!/bin/sh
set -e

# Bind-mounted volumes may be created by Docker as root.
# Fix ownership so the node user can write previews and medium files.
mkdir -p /app/public/previews /app/public/medium
chown node:node /app/public/previews /app/public/medium

# Make the Docker socket world-accessible so the node user can query it.
if [ -S /var/run/docker.sock ]; then
  chmod 666 /var/run/docker.sock
fi

exec su-exec node "$@"
