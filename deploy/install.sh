#!/bin/sh
# Instalador de AstroCitas (servidor) — curl -fsSL https://github.com/AstroSoftwareMoon/AstroCitas/releases/latest/download/install.sh | sh
# Funciona en Debian/Ubuntu/Raspberry Pi OS y cualquier Linux con Docker. Idempotente.
set -eu
DIR="${ASTROCITAS_DIR:-$HOME/astrocitas}"
# Los archivos de despliegue se publican en cada release: siempre coinciden con la última versión.
BASE="${ASTROCITAS_BASE:-https://github.com/AstroSoftwareMoon/AstroCitas/releases/latest/download}"

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  say "Instalando Docker…"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "Necesitas Docker Compose v2"; exit 1; }

mkdir -p "$DIR" && cd "$DIR"
[ -f docker-compose.yml ] || curl -fsSL "$BASE/docker-compose.yml" -o docker-compose.yml
[ -f Caddyfile ] || curl -fsSL "$BASE/Caddyfile" -o Caddyfile
[ -f .env.example ] || curl -fsSL "$BASE/env.example" -o .env.example

if [ ! -f .env ]; then
  cp .env.example .env
  secret=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sed -i.bak "s/^ASTRO_SECRET=.*/ASTRO_SECRET=$secret/" .env && rm -f .env.bak
  printf 'Dominio (p. ej. citas.tudominio.es; Intro = probar en este equipo con localhost): '
  read -r domain < /dev/tty || domain=""
  # Sin dominio, Caddy sirve https://localhost con un certificado local
  sed -i.bak "s/^DOMAIN=.*/DOMAIN=${domain:-localhost}/" .env && rm -f .env.bak
fi

say "Descargando e iniciando AstroCitas…"
docker compose pull
docker compose up -d
. ./.env
say "¡Listo! Abre https://$DOMAIN para crear tu cuenta de administrador."
say "Comprobación: curl -fsS https://$DOMAIN/health"
