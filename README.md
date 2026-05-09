# Photo Book

A self-hosted photo gallery with support for 360° panoramic photos, GPS map, view counts and likes — deployable on any Linux VPS with a single script.

---

## Introduction

Photo Book is a lightweight personal photo gallery designed to be run on a private server. Drop your photos into album folders and the app takes care of the rest: it reads EXIF metadata, generates low-resolution previews, detects 360° panoramas and displays them in an immersive viewer, and plots GPS-tagged photos on an interactive map.

Key features:

- **Album browser** — photos are organised into sub-directories; the app scans them automatically on startup
- **360° viewer** — equirectangular panoramas (detected via EXIF `ProjectionType` or a 2:1 aspect ratio) are rendered with Pannellum
- **Interactive map** — all GPS-tagged photos are plotted across albums; clicking a marker opens the photo
- **View counts & likes** — tracked per user session (anonymous UUID) and persisted in PostgreSQL
- **Reverse geocoding** — GPS coordinates are resolved to human-readable place names via Nominatim (OpenStreetMap), cached in memory
- **Preview generation** — sharp generates JPEG previews on first access and caches them to disk; subsequent server restarts are near-instant

No login, no cloud dependency, no tracking.

---

## Architecture

```
Browser
  │
  │  HTTPS (443)
  ▼
┌─────────────────────────────────────────────────┐
│  Traefik  (reverse proxy + TLS)                 │
│  • HTTP → HTTPS redirect                        │
│  • Let's Encrypt certificate (ACME)             │
│  • HSTS header                                  │
│  • Routes *.domain → photo-book:3000            │
└────────────────────┬────────────────────────────┘
                     │  HTTP (internal network)
                     ▼
┌────────────────────────────────────────────────┐
│  photo-book  (Node.js / Express)               │
│                                                │
│  GET  /api/albums          album list          │
│  GET  /api/albums/:name    photos + metadata   │
│  GET  /api/map             all GPS photos      │
│  GET  /api/geocode         reverse geocoding   │
│  POST /api/view            record a view       │
│  POST /api/like            toggle a like       │
│  GET  /api/liked           liked filenames     │
│                                                │
│  Static: public/  (HTML, CSS, JS)              │
│  Static: /photos  (original images)            │
│  Static: /previews (generated thumbnails)      │
└───────────┬──────────────────┬─────────────────┘
            │  SQL (pg)        │  filesystem
            ▼                  ▼
┌─────────────────┐   ┌──────────────────────────┐
│   PostgreSQL    │   │  Volumes                 │
│                 │   │  ./photos/               │
│  photo_views    │   │    └── Album Name/       │
│  photo_likes    │   │         └── img.jpg      │
│  photo_view_log │   │  ./public/previews/      │
└─────────────────┘   │    └── Album Name/       │
                       │         └── img.jpg      │
                       └──────────────────────────┘
```

### Containers

| Container | Image | Role |
|---|---|---|
| `traefik` | `traefik:v3.3` | Reverse proxy, TLS termination, HTTP→HTTPS redirect, HSTS |
| `photo-book` | `jarod68/photo-book:latest` | Node.js application server |
| `postgres` | `postgres:16-alpine` | Persistent storage for views and likes |

All three containers share a `proxy` bridge network. Traefik and photo-book communicate over this network; the Docker socket is not mounted (routing is configured via a static file provider).

### Configuration files

| File | Versioned | Description |
|---|---|---|
| `docker-compose.yml` | ✓ | Full stack definition with `${VAR}` references |
| `traefik/static.yml` | ✓ | Traefik entrypoints, ACME, file provider |
| `traefik/dynamic.yml` | generated | Router rule (domain), service URL, middlewares |
| `postgres-init/01-init.sql` | ✓ | Database schema |
| `.env` | generated | Secrets and server-specific values |
| `letsencrypt/acme.json` | generated | TLS certificate store (chmod 600) |

`deploy.sh` generates the three files marked *generated*; everything else lives in the repository.

### Preview pipeline

On first access to an album, `ensurePreview` is called for each photo:

```
Original JPEG/PNG/WEBP
  └─► sharp.rotate()           ← apply EXIF orientation
      .resize(1024 or 1536)    ← 1536 px for 360° photos
      .jpeg({ quality: 76 })
      .toFile(public/previews/AlbumName/photo.jpg)
```

Previews are served as static files by Express and persist across container restarts via a bind-mounted volume.

---

## Implementation

### Backend

| Technology | Version | Role |
|---|---|---|
| Node.js | 22 (Alpine) | Runtime |
| Express | 4.x | HTTP server and routing |
| sharp | 0.34 | Image resizing and JPEG encoding |
| exifr | 7.x | EXIF/XMP/IPTC/GPS metadata extraction |
| pg | 8.x | PostgreSQL client |

The backend is written in CommonJS (`require`/`module.exports`) and runs as a single process. On startup it:

1. Connects to PostgreSQL with a retry loop (up to 10 attempts)
2. Syncs the filesystem to the database (inserts any new photo rows)
3. Pre-generates missing previews in the background

### Frontend

The frontend is vanilla JavaScript with ES modules — no bundler, no framework.

```
public/
├── index.html          home page (album grid)
├── viewer.html         photo viewer + 360° (Pannellum)
├── map.html            global GPS map (Leaflet)
├── api/
│   └── client.js       fetch wrappers for all API endpoints
├── utils/
│   ├── format.js       date/number formatting helpers
│   ├── map-math.js     GPS clustering and route segmentation
│   └── user-token.js   anonymous UUID session management
├── pages/
│   ├── home.js         album listing page logic
│   ├── viewer.js       photo viewer page logic
│   └── map.js          map page logic
└── components/
    ├── album-card.js   album grid card
    ├── album-map.js    per-album mini map
    ├── album-tabs.js   tab navigation
    ├── map-marker.js   Leaflet custom marker
    ├── photo-map.js    full-screen map component
    ├── photo-viewer.js photo display + controls
    └── thumbnail-strip.js  horizontal thumbnail strip
```

External libraries loaded from CDN: **Pannellum** (360° viewer), **Leaflet** (maps).

### Database schema

```sql
-- View counting (deduplicated by user token)
CREATE TABLE photo_view_log (
  album       VARCHAR(255),
  filename    VARCHAR(255),
  user_token  UUID,
  PRIMARY KEY (album, filename, user_token)
);

CREATE TABLE photo_views (
  id        SERIAL PRIMARY KEY,
  album     VARCHAR(255) NOT NULL,
  filename  VARCHAR(255) NOT NULL,
  views     BIGINT NOT NULL DEFAULT 0,
  UNIQUE (album, filename)
);

-- Likes (toggleable, deduplicated by user token)
CREATE TABLE photo_likes (
  album       VARCHAR(255),
  filename    VARCHAR(255),
  user_token  UUID,
  PRIMARY KEY (album, filename, user_token)
);
```

Views are deduplicated: a user token can only increment the counter once per photo. Likes are toggleable.

---

## Tests unitaires

The test suite uses **Vitest 2.x** with V8 coverage.

```
tests/
├── client/
│   ├── api-client.test.js    API client fetch wrappers
│   ├── format.test.js        date/number formatters
│   ├── map-math.test.js      GPS clustering, route segmentation
│   └── user-token.test.js    UUID session persistence
├── server/
│   └── routes.test.js        Express routes (supertest)
└── services/
    ├── database.test.js      connectDb, syncPhotosToDb
    ├── image.test.js         isImage, isAlbumDir, EXIF extension handling
    └── image-meta.test.js    ensurePreview, photoMeta, preGenerateAll
```

### Design patterns

**Dependency injection** — service functions accept an optional `_deps` argument, allowing tests to inject mock implementations of `fs`, `sharp` and `exifr` without touching the module cache:

```js
await ensurePreview('Paris', 'photo.jpg', '/src/photo.jpg', false, {
  fs: mockFs,
  sharp: mockSharp,
});
```

**CJS/ESM interop** — tests are ESM (`import`); the backend is CJS (`require`). `createRequire(import.meta.url)` is used in `routes.test.js` to access the same Node.js module cache instance as `server.js`, ensuring that state injected via `database._setState(...)` is visible to the running Express app.

**No real I/O** — no test writes to disk, opens a real database connection, or spawns a child process. Database tests inject a `{ query: mockFn }` pool directly into `connectDb(pool)`.

### Running tests

```bash
# Run all tests once
npm test

# Watch mode
npm run test:watch

# With coverage report (HTML output in coverage/)
npm run test:coverage
```

Coverage targets: `server.js`, `services/**`, `public/api/**`, `public/utils/**`.

---

## How to deploy

### Prerequisites

- A Linux VPS (Ubuntu 22.04+ or Debian 12+ recommended)
- A domain name pointing to the server's IP
- SSH access as root (or a user with `sudo`)
- Port 80 and 443 open in the firewall

### 1 — Clone the repository

```bash
git clone https://github.com/jarod68/photo-book.git
cd photo-book
```

### 2 — Run the deploy script

```bash
sudo ./deploy.sh \
  --domain your.domain.com \
  --email  you@example.com
```

Optional flags:

| Flag | Default | Description |
|---|---|---|
| `--domain` | `book.holtz.fr` | Public hostname |
| `--email` | `noname@book.holtz.fr` | ACME e-mail for Let's Encrypt |
| `--photos-dir` | `/opt/photo-book/photos` | Host path where albums are stored |
| `--update` | — | Re-sync files, rewrite config, pull latest image and restart |

The script:

1. Installs Docker and Docker Compose if not present
2. Generates a random PostgreSQL password (saved to `/opt/photo-book/.postgres_password` for future updates)
3. Writes `/opt/photo-book/.env` with all deployment variables
4. Generates `traefik/dynamic.yml` with the router rule for your domain
5. Creates directories (`photos/`, `public/previews/`, `letsencrypt/`)
6. Initialises `letsencrypt/acme.json` with the required `chmod 600`
7. Pulls Docker images and starts the stack
8. Registers a systemd service (`photo-book.service`) that starts automatically on boot

### 3 — Add photos

Copy your album directories into the photos folder:

```bash
cp -r /path/to/My\ Trip /opt/photo-book/photos/
```

Each directory becomes an album. Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.tiff`.

Previews are generated automatically on the next page load (or in the background on the next restart).

### Updating

```bash
cd /path/to/photo-book
git pull
sudo ./deploy.sh --update
```

### Useful commands

```bash
# View live logs
journalctl -u photo-book -f

# Container logs
docker compose -f /opt/photo-book/docker-compose.yml logs -f

# Restart the stack
systemctl restart photo-book

# Stop the stack
systemctl stop photo-book
```
