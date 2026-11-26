#!/bin/sh
# Instalador de AstroCitas (servidor) — curl -fsSL https://github.com/AstroSoftwareMoon/AstroCitas/releases/latest/download/install.sh | sh
# Funciona en Debian/Ubuntu/Raspberry Pi OS y cualquier Linux con Docker. Idempotente.
set -eu
DIR="${ASTROCITAS_DIR:-$HOME/astrocitas}"
# Los archivos de despliegue se publican en cada release: siempre coinciden con la última versión.
BASE="${ASTROCITAS_BASE:-https://github.com/AstroSoftwareMoon/AstroCitas/releases/latest/download}"

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
set_env() { sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; }
# IP del equipo en la red local (la interfaz por la que sale a internet)
local_ip() {
  found=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')
  [ -n "$found" ] || found=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "$found" ] || found=$(ipconfig getifaddr en0 2>/dev/null || true)
  echo "$found"
}

if ! command -v docker >/dev/null 2>&1; then
  say "Instalando Docker…"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "Necesitas Docker Compose v2"; exit 1; }

mkdir -p "$DIR" && cd "$DIR"
# docker-compose y Caddyfile se actualizan siempre; tu configuración vive en .env y no se toca.
curl -fsSL "$BASE/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$BASE/Caddyfile" -o Caddyfile
curl -fsSL "$BASE/env.example" -o .env.example

# Sin .env (o con el dominio de ejemplo de un intento anterior): configurar.
if [ ! -f .env ] || grep -q '^DOMAIN=citas.tudominio.es$' .env; then
  cp .env.example .env
  secret=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sed -i.bak "s/^ASTRO_SECRET=.*/ASTRO_SECRET=$secret/" .env && rm -f .env.bak
  printf 'Dominio (p. ej. citas.tudominio.es). Si no tienes, pulsa Intro y se usará la IP de este equipo: '
  read -r domain < /dev/tty || domain=""
  if [ -n "$domain" ]; then
    set_env DOMAIN "$domain"
  else
    ip=$(local_ip)
    [ -n "$ip" ] || { echo "No se pudo detectar la IP. Vuelve a ejecutarlo e indica un dominio o edita SITE/PUBLIC_URL en $DIR/.env"; exit 1; }
    set_env DOMAIN "$ip"
    printf 'SITE=:80\nPUBLIC_URL=http://%s\n' "$ip" >> .env
  fi
fi

say "Descargando e iniciando AstroCitas…"
docker compose pull
docker compose up -d
. ./.env
url="${PUBLIC_URL:-https://$DOMAIN}"
say "¡Listo! AstroCitas está en:  $url"
echo
echo "  1. Abre $url en el navegador y crea tu cuenta de administrador."
echo "  2. En la app: «Conectar a mi servidor» → escribe  $url"
case "$url" in http://*)
  echo
  echo "  Sin dominio funciona en tu red local (wifi de casa o del negocio)."
  echo "  Si la IP del equipo cambia, edita PUBLIC_URL en $DIR/.env y ejecuta: docker compose up -d"
  echo "  Consejo: fija la IP del equipo en el router (reserva DHCP).";;
esac
echo
echo "  Comprobación: curl -fsS $url/health"
