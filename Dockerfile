FROM node:22-alpine

WORKDIR /app

# Copy manifests first — layer is cached unless dependencies change
COPY package.json package-lock.json ./

# Install production dependencies only
# sharp ships a prebuilt musl binary for Alpine — no system libvips needed
# Remove npm after install: not needed at runtime, eliminates bundled CVEs
RUN npm ci --omit=dev \
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

EXPOSE 3000

# Entrypoint runs as root to fix bind-mount permissions, then drops to node via su-exec
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
