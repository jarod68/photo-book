FROM node:22-alpine

WORKDIR /app

# Copy manifests first — layer is cached unless dependencies change
COPY package.json package-lock.json ./

# Install production dependencies only
# sharp ships a prebuilt musl binary for Alpine — no system libvips needed
RUN npm ci --omit=dev

# Application source
COPY server.js ./
COPY public/   ./public/

# Directories that should be mounted as volumes at runtime:
#   /app/photos          — albums (read-only is fine)
#   /app/public/previews — generated low-res cache (writable)
RUN mkdir -p photos public/previews

EXPOSE 3000

CMD ["node", "server.js"]
