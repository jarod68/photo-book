#!/usr/bin/env bash
# deploy.sh — Install / update photo-book on a Linux server
# Traefik (HTTPS + Let's Encrypt) → photo-book:3000 + MySQL
# Usage: sudo ./deploy.sh [--photos-dir /path] [--update]

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERR]${RESET}   $*" >&2; exit 1; }

# ── Defaults ──────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/photo-book"
PHOTOS_DIR=""
ACME_EMAIL="noname@book.holtz.fr"
DOMAIN="book.holtz.fr"
IMAGE="jarod68/photo-book:latest"
TRAEFIK_IMAGE="traefik:v3.3"
POSTGRES_IMAGE="postgres:16-alpine"
SERVICE="photo-book"
UPDATE_ONLY=false

# ── PostgreSQL password (generated once, persisted across updates) ────────────
POSTGRES_PASS_FILE="/opt/photo-book/.postgres_password"
if [[ -f "$POSTGRES_PASS_FILE" ]]; then
  POSTGRES_PASSWORD="$(cat "$POSTGRES_PASS_FILE")"
else
  POSTGRES_PASSWORD="$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)"
fi

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --photos-dir) PHOTOS_DIR="$2"; shift 2 ;;
    --update)     UPDATE_ONLY=true; shift ;;
    --help|-h)
      echo "Usage: sudo $0 [--photos-dir /path] [--update]"
      echo "  --photos-dir  Host path for photo storage (default: $INSTALL_DIR/photos)"
      echo "  --update      Rewrite config files, pull latest images and restart"
      exit 0 ;;
    *) error "Unknown option: $1. Use --help for usage." ;;
  esac
done

[[ -z "$PHOTOS_DIR" ]] && PHOTOS_DIR="$INSTALL_DIR/photos"
PREVIEWS_DIR="$INSTALL_DIR/public/previews"
LETSENCRYPT_DIR="$INSTALL_DIR/letsencrypt"

# ── Root check ────────────────────────────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || error "Please run as root: sudo $0"

# ── OS detection ──────────────────────────────────────────────────────────────
if   command -v apt-get &>/dev/null; then PKG_MGR="apt"
elif command -v dnf     &>/dev/null; then PKG_MGR="dnf"
elif command -v yum     &>/dev/null; then PKG_MGR="yum"
else warn "Package manager not detected — skipping Docker auto-install."; PKG_MGR="none"
fi

# ── Docker ────────────────────────────────────────────────────────────────────
install_docker() {
  info "Docker not found. Installing via get.docker.com …"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  success "Docker installed and started."
}

if ! command -v docker &>/dev/null; then
  [[ "$PKG_MGR" == "none" ]] && error "Docker is required but not installed. Install it manually."
  install_docker
else
  success "Docker $(docker --version | awk '{print $3}' | tr -d ',') detected."
fi

# ── Docker Compose ────────────────────────────────────────────────────────────
if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose &>/dev/null; then
  DC="docker-compose"
else
  info "Docker Compose plugin not found. Installing …"
  if [[ "$PKG_MGR" == "apt" ]]; then
    apt-get install -y docker-compose-plugin &>/dev/null
    DC="docker compose"
  else
    COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest \
      | grep '"tag_name"' | sed 's/.*: "\(.*\)".*/\1/')
    curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" \
      -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    DC="docker-compose"
  fi
  success "Docker Compose installed."
fi
success "Compose command: ${BOLD}${DC}${RESET}"

# ══════════════════════════════════════════════════════════════════════════════
# Config writers
# ══════════════════════════════════════════════════════════════════════════════

write_postgres_init() {
  info "Writing $INSTALL_DIR/postgres-init/01-init.sql …"
  mkdir -p "$INSTALL_DIR/postgres-init"
  cat > "$INSTALL_DIR/postgres-init/01-init.sql" <<SQL
CREATE TABLE IF NOT EXISTS photo_views (
  id       SERIAL PRIMARY KEY,
  album    VARCHAR(255) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  views    BIGINT       NOT NULL DEFAULT 0,
  UNIQUE (album, filename)
);
SQL
  chmod 640 "$INSTALL_DIR/postgres-init/01-init.sql"
  success "postgres-init/01-init.sql written."
}

write_traefik_static() {
  info "Writing $INSTALL_DIR/traefik.yml …"
  cat > "$INSTALL_DIR/traefik.yml" <<TRAEFIK
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"

certificatesResolvers:
  letsencrypt:
    acme:
      email: ${ACME_EMAIL}
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web

providers:
  file:
    filename: /config/dynamic.yml
    watch: true

api:
  dashboard: false

log:
  level: WARN

accessLog: {}
TRAEFIK
  success "traefik.yml written."
}

write_traefik_dynamic() {
  info "Writing $INSTALL_DIR/dynamic.yml …"
  cat > "$INSTALL_DIR/dynamic.yml" <<DYNAMIC
http:
  routers:
    photo-book:
      rule: "Host(\`${DOMAIN}\`)"
      entryPoints:
        - websecure
      service: photo-book
      tls:
        certResolver: letsencrypt
      middlewares:
        - hsts

  services:
    photo-book:
      loadBalancer:
        servers:
          - url: "http://photo-book:3000"

  middlewares:
    hsts:
      headers:
        stsSeconds: 31536000
        stsIncludeSubdomains: true
        stsPreload: true
        forceSTSHeader: true
DYNAMIC
  success "dynamic.yml written."
}

write_compose() {
  info "Writing $INSTALL_DIR/docker-compose.yml …"
  cat > "$INSTALL_DIR/docker-compose.yml" <<COMPOSE
services:

  # ── Reverse proxy ─────────────────────────────────────────────────────────
  traefik:
    image: ${TRAEFIK_IMAGE}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ${INSTALL_DIR}/traefik.yml:/etc/traefik/traefik.yml:ro
      - ${INSTALL_DIR}/dynamic.yml:/config/dynamic.yml:ro
      - ${LETSENCRYPT_DIR}:/letsencrypt
    networks:
      - proxy

  # ── Base de données ────────────────────────────────────────────────────────
  postgres:
    image: ${POSTGRES_IMAGE}
    restart: unless-stopped
    environment:
      POSTGRES_DB: photobook
      POSTGRES_USER: photobook
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ${INSTALL_DIR}/postgres-init:/docker-entrypoint-initdb.d:ro
    networks:
      - proxy
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U photobook -d photobook"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 20s

  # ── Application ───────────────────────────────────────────────────────────
  photo-book:
    image: ${IMAGE}
    restart: unless-stopped
    expose:
      - "3000"
    volumes:
      - ${PHOTOS_DIR}:/app/photos
      - ${PREVIEWS_DIR}:/app/public/previews
    environment:
      - NODE_ENV=production
      - POSTGRES_HOST=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - proxy

networks:
  proxy:
    driver: bridge

volumes:
  postgres-data:
COMPOSE
  success "docker-compose.yml written."
}

# ── Update-only shortcut ──────────────────────────────────────────────────────
if $UPDATE_ONLY; then
  [[ -f "$INSTALL_DIR/docker-compose.yml" ]] \
    || error "No existing install found at $INSTALL_DIR. Run without --update first."
  write_postgres_init
  write_traefik_static
  write_traefik_dynamic
  write_compose
  info "Pulling latest images …"
  cd "$INSTALL_DIR"
  $DC pull
  $DC up -d --force-recreate --remove-orphans
  success "photo-book updated and restarted."
  exit 0
fi

# ── Fresh install ─────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}Installation directory : ${CYAN}$INSTALL_DIR${RESET}"
echo -e "${BOLD}Photos directory       : ${CYAN}$PHOTOS_DIR${RESET}"
echo -e "${BOLD}Domain                 : ${CYAN}https://${DOMAIN}${RESET}"
echo -e "${BOLD}ACME e-mail            : ${CYAN}$ACME_EMAIL${RESET}"
echo -e "${BOLD}App image              : ${CYAN}$IMAGE${RESET}"
echo -e "${BOLD}Traefik image          : ${CYAN}$TRAEFIK_IMAGE${RESET}"
echo -e "${BOLD}Postgres image         : ${CYAN}$POSTGRES_IMAGE${RESET}"
echo

# ── Directories ───────────────────────────────────────────────────────────────
info "Creating directories …"
mkdir -p "$INSTALL_DIR" "$PHOTOS_DIR" "$PREVIEWS_DIR" "$LETSENCRYPT_DIR"
chmod 755 "$INSTALL_DIR"
chmod 777 "$PHOTOS_DIR" "$PREVIEWS_DIR"
touch "$LETSENCRYPT_DIR/acme.json"
chmod 600 "$LETSENCRYPT_DIR/acme.json"
success "Directories ready."

# ── Save generated password (first install only) ──────────────────────────────
if [[ ! -f "$POSTGRES_PASS_FILE" ]]; then
  echo -n "$POSTGRES_PASSWORD" > "$POSTGRES_PASS_FILE"
  chmod 600 "$POSTGRES_PASS_FILE"
  success "PostgreSQL password generated and saved to $POSTGRES_PASS_FILE"
fi

write_postgres_init
write_traefik_static
write_traefik_dynamic
write_compose

# ── Pull images ───────────────────────────────────────────────────────────────
info "Pulling images from Docker Hub …"
cd "$INSTALL_DIR"
$DC pull
success "Images pulled."

# ── systemd service ───────────────────────────────────────────────────────────
info "Writing /etc/systemd/system/${SERVICE}.service …"

DOCKER_BIN=$(command -v docker)
if [[ "$DC" == "docker compose" ]]; then
  EXEC_START="${DOCKER_BIN} compose --project-directory ${INSTALL_DIR} up --remove-orphans"
  EXEC_STOP="${DOCKER_BIN} compose --project-directory ${INSTALL_DIR} down"
else
  DC_BIN=$(command -v docker-compose)
  EXEC_START="${DC_BIN} --project-directory ${INSTALL_DIR} up --remove-orphans"
  EXEC_STOP="${DC_BIN} --project-directory ${INSTALL_DIR} down"
fi

cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=Photo Book — Traefik + App + MySQL (Docker Compose)
Documentation=https://github.com/jarod68/photo-book
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${EXEC_START}
ExecStop=${EXEC_STOP}
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE}

[Install]
WantedBy=multi-user.target
EOF
success "Systemd unit written."

# ── Enable & start ────────────────────────────────────────────────────────────
info "Enabling and starting ${SERVICE}.service …"
systemctl daemon-reload
systemctl enable "${SERVICE}.service"
systemctl restart "${SERVICE}.service"

sleep 5
systemctl is-active --quiet "${SERVICE}.service" \
  && success "Service is running." \
  || warn "Service may still be starting (MySQL init ~30 s). Check: journalctl -u ${SERVICE} -f"

# ── Final summary ─────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║  photo-book déployé avec succès !                ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${RESET}"
echo
echo -e "  URL            : ${BOLD}https://${DOMAIN}${RESET}"
echo -e "  Photos         : ${BOLD}${PHOTOS_DIR}${RESET}"
echo -e "  Certificat TLS : ${BOLD}${LETSENCRYPT_DIR}/acme.json${RESET}"
echo -e "  Logs           : ${BOLD}journalctl -u ${SERVICE} -f${RESET}"
echo -e "  Logs Postgres  : ${BOLD}cd ${INSTALL_DIR} && ${DC} logs -f postgres${RESET}"
echo -e "  Mise à jour    : ${BOLD}sudo $0 --update${RESET}"
echo
echo -e "  ${YELLOW}Note :${RESET} DNS ${BOLD}${DOMAIN}${RESET} doit pointer vers l'IP de ce serveur."
echo

