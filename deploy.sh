#!/usr/bin/env bash
# deploy.sh — Install / update photo-book on a Linux server
# Usage: sudo ./deploy.sh [--domain example.com] [--email you@example.com] [--photos-dir /path] [--update]

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
DOMAIN="book.holtz.fr"
ACME_EMAIL="noname@book.holtz.fr"
PHOTOS_DIR=""
IMAGE="jarod68/photo-book:latest"
TRAEFIK_IMAGE="traefik:v3.3"
POSTGRES_IMAGE="postgres:16-alpine"
SERVICE="photo-book"
UPDATE_ONLY=false

# Directory of this script (= project root when the repo is present)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)     DOMAIN="$2";    shift 2 ;;
    --email)      ACME_EMAIL="$2"; shift 2 ;;
    --photos-dir) PHOTOS_DIR="$2"; shift 2 ;;
    --update)     UPDATE_ONLY=true; shift ;;
    --help|-h)
      echo "Usage: sudo $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --domain      Hostname (default: $DOMAIN)"
      echo "  --email       ACME e-mail for Let's Encrypt (default: $ACME_EMAIL)"
      echo "  --photos-dir  Host path for photo storage (default: $INSTALL_DIR/photos)"
      echo "  --update      Re-sync files, rewrite .env, pull latest images and restart"
      exit 0 ;;
    *) error "Unknown option: $1. Use --help for usage." ;;
  esac
done

[[ -z "$PHOTOS_DIR" ]] && PHOTOS_DIR="$INSTALL_DIR/photos"
PREVIEWS_DIR="$INSTALL_DIR/public/previews"
MEDIUM_DIR="$INSTALL_DIR/public/medium"
LETSENCRYPT_DIR="$INSTALL_DIR/letsencrypt"
POSTGRES_PASS_FILE="$INSTALL_DIR/.postgres_password"

# ── Root check ────────────────────────────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || error "Please run as root: sudo $0"

# ── PostgreSQL password (generated once, persisted across updates) ────────────
if [[ -f "$POSTGRES_PASS_FILE" ]]; then
  POSTGRES_PASSWORD="$(cat "$POSTGRES_PASS_FILE")"
else
  POSTGRES_PASSWORD="$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)"
fi

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

# ── Sync project files to INSTALL_DIR ────────────────────────────────────────
# Copies everything except secrets, media, and generated files.
sync_project_files() {
  if [[ "$SCRIPT_DIR" == "$INSTALL_DIR" ]]; then
    info "Running from $INSTALL_DIR — no copy needed."
    return
  fi
  info "Syncing project files to $INSTALL_DIR …"
  mkdir -p "$INSTALL_DIR"
  rsync -a --delete \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='.postgres_password' \
    --exclude='node_modules/' \
    --exclude='photos/' \
    --exclude='public/previews/' \
    --exclude='letsencrypt/' \
    --exclude='coverage/' \
    --exclude='.git/' \
    "$SCRIPT_DIR/" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/docker-entrypoint.sh"
  success "Project files synced."
}

# ── Write traefik/dynamic.yml (server-specific domain) ───────────────────────
write_traefik_dynamic() {
  info "Writing $INSTALL_DIR/traefik/dynamic.yml …"
  mkdir -p "$INSTALL_DIR/traefik"
  cat > "$INSTALL_DIR/traefik/dynamic.yml" <<DYNAMIC
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

    adminer:
      rule: "Host(\`${DOMAIN}\`) && PathPrefix(\`/db\`)"
      entryPoints:
        - websecure
      service: adminer
      tls:
        certResolver: letsencrypt
      middlewares:
        - hsts

  services:
    photo-book:
      loadBalancer:
        servers:
          - url: "http://photo-book:3000"

    adminer:
      loadBalancer:
        servers:
          - url: "http://adminer:8080"

  middlewares:
    hsts:
      headers:
        stsSeconds: 31536000
        stsIncludeSubdomains: true
        stsPreload: true
        forceSTSHeader: true
DYNAMIC
  success "traefik/dynamic.yml written."
}

# ── Write .env ────────────────────────────────────────────────────────────────
write_env() {
  info "Writing $INSTALL_DIR/.env …"
  # Detect the host docker group GID so the container can access the Docker socket
  # via group membership (group_add) without chmod 666.
  DOCKER_GID=$(getent group docker 2>/dev/null | cut -d: -f3 \
    || stat -c '%g' /var/run/docker.sock 2>/dev/null \
    || echo "999")
  cat > "$INSTALL_DIR/.env" <<ENV
DOMAIN=${DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
PHOTOS_DIR=${PHOTOS_DIR}
IMAGE=${IMAGE}
TRAEFIK_IMAGE=${TRAEFIK_IMAGE}
POSTGRES_IMAGE=${POSTGRES_IMAGE}
DOCKER_GID=${DOCKER_GID}
ENV
  chmod 600 "$INSTALL_DIR/.env"
  success ".env written (DOCKER_GID=${DOCKER_GID})."
}

# ── Update-only shortcut ──────────────────────────────────────────────────────
if $UPDATE_ONLY; then
  [[ -f "$INSTALL_DIR/docker-compose.yml" ]] \
    || error "No existing install found at $INSTALL_DIR. Run without --update first."
  sync_project_files
  write_traefik_dynamic
  write_env
  info "Ensuring writable directories …"
  mkdir -p "$PREVIEWS_DIR" "$MEDIUM_DIR"
  chmod 777 "$PREVIEWS_DIR" "$MEDIUM_DIR"
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
mkdir -p "$PHOTOS_DIR" "$PREVIEWS_DIR" "$MEDIUM_DIR" "$LETSENCRYPT_DIR"
chmod 777 "$PHOTOS_DIR" "$PREVIEWS_DIR" "$MEDIUM_DIR"
touch "$LETSENCRYPT_DIR/acme.json"
chmod 600 "$LETSENCRYPT_DIR/acme.json"
success "Directories ready."

# ── Save generated password (first install only) ──────────────────────────────
if [[ ! -f "$POSTGRES_PASS_FILE" ]]; then
  echo -n "$POSTGRES_PASSWORD" > "$POSTGRES_PASS_FILE"
  chmod 600 "$POSTGRES_PASS_FILE"
  success "PostgreSQL password generated and saved to $POSTGRES_PASS_FILE"
fi

sync_project_files
write_traefik_dynamic
write_env

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
Description=Photo Book — Traefik + App + PostgreSQL (Docker Compose)
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
  || warn "Service may still be starting (PostgreSQL init ~30 s). Check: journalctl -u ${SERVICE} -f"

# ── Final summary ─────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║  photo-book deployed successfully!               ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${RESET}"
echo
echo -e "  URL            : ${BOLD}https://${DOMAIN}${RESET}"
echo -e "  Photos         : ${BOLD}${PHOTOS_DIR}${RESET}"
echo -e "  TLS certificate: ${BOLD}${LETSENCRYPT_DIR}/acme.json${RESET}"
echo -e "  Logs           : ${BOLD}journalctl -u ${SERVICE} -f${RESET}"
echo -e "  Logs Postgres  : ${BOLD}cd ${INSTALL_DIR} && ${DC} logs -f postgres${RESET}"
echo -e "  Update         : ${BOLD}sudo $0 --update${RESET}"
echo
echo -e "  ${YELLOW}Note:${RESET} DNS ${BOLD}${DOMAIN}${RESET} must point to this server's IP address."
echo
