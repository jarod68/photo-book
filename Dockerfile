FROM node:26-alpine

WORKDIR /app

# Copy manifests first — layer is cached unless dependencies change
COPY package.json package-lock.json ./

# Apply latest OS security patches, install production dependencies only.
# sharp ships a prebuilt musl binary for Alpine — no system libvips needed.
# Remove npm after install: not needed at runtime, eliminates bundled CVEs.
RUN apk upgrade --no-cache \
  && npm ci --omit=dev \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
            /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
  && apk add --no-cache su-exec

# Bundled application — built by `npm run build` before docker build
COPY dist/server.js ./server.js
COPY dist/public/   ./public/

# Build stamp shown in a page corner (utils/build-tag.js), so a tester knows
# which commit they are looking at (QA) before promoting it to prod.
ARG GIT_SHA=dev
RUN printf '{"sha":"%s"}\n' "$GIT_SHA" > public/version.json

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
