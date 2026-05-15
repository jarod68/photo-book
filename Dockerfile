FROM node:24-alpine

WORKDIR /app

# Copy manifests first — layer is cached unless dependencies change
COPY package.json package-lock.json ./

# Apply latest OS security patches, install production dependencies only.
# sharp ships a prebuilt musl binary for Alpine — no system libvips needed.
# Remove npm after install: not needed at runtime, eliminates bundled CVEs.
RUN apk upgrade --no-cache \
  && npm ci --omit=dev \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && apk add --no-cache su-exec

# Application source
COPY server.js   ./
COPY services/   ./services/
COPY public/     ./public/

# Create volume mount points and transfer full ownership to the node user (uid 1000)
# node_modules/ was created by root during npm ci — chown covers it too
RUN mkdir -p photos public/previews public/medium \
  && chown -R node:node /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Declare non-root user so Docker Scout / image scanners see a safe default.
# docker-compose overrides this to root so the entrypoint can chown bind-mount
# volumes and fix the Docker socket, then su-exec drops back to node (uid 1000).
USER node

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
