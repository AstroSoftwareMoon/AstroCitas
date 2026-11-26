#!/bin/sh
# Instalador de AstroCitas (servidor) — curl -fsSL https://github.com/AstroSoftwareMoon/AstroCitas/releases/latest/download/install.sh | sh
# Desinstalar (borra servidor y datos):  curl -fsSL …/install.sh | sh -s -- --uninstall
# Funciona en Debian/Ubuntu/Fedora/Arch/Raspberry Pi OS y cualquier Linux con Docker. Idempotente.
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

ACTION="${1:-install}"

if ! command -v docker >/dev/null 2>&1; then
  [ "$ACTION" = "--uninstall" ] && { echo "Docker no está instalado: no hay nada que eliminar."; exit 0; }
  say "Instalando Docker…"
  curl -fsSL https://get.docker.com | sh
fi

# Usar docker directamente o con sudo si el usuario no está en el grupo «docker».
SUDO=""
if ! docker info >/dev/null 2>&1; then
  if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    say "Docker necesita permisos de administrador: se usará sudo (te pedirá tu contraseña)."
    SUDO="sudo"
  fi
  if ! $SUDO docker info >/dev/null 2>&1; then
    # El motor puede estar parado (recién instalado): arrancarlo.
    command -v systemctl >/dev/null 2>&1 && $SUDO systemctl enable --now docker >/dev/null 2>&1 || true
    $SUDO docker info >/dev/null 2>&1 || { echo "No se puede usar Docker. Comprueba que está instalado y en marcha: sudo systemctl start docker"; exit 1; }
  fi
fi
dc() { $SUDO docker compose "$@"; }
dc version >/dev/null 2>&1 || { echo "Necesitas Docker Compose v2 (paquete docker-compose-plugin)"; exit 1; }

if [ "$ACTION" = "--uninstall" ]; then
  [ -f "$DIR/docker-compose.yml" ] || { echo "No hay ninguna instalación en $DIR"; exit 0; }
  cd "$DIR"
  printf '\033[1;31m▸ Se eliminará AstroCitas y TODOS sus datos (citas, clientes, cuentas y copias del servidor).\033[0m\n'
  echo "  Si quieres conservarlos, antes exporta una copia desde la app (Ajustes → Tus datos)."
  printf 'Escribe BORRAR para confirmar: '
  read -r answer < /dev/tty || answer=""
  [ "$answer" = "BORRAR" ] || { echo "Cancelado. No se ha borrado nada."; exit 0; }
  dc --profile postgres --profile redis down --volumes --remove-orphans --rmi all || true
  cd / && rm -rf "$DIR"
  say "AstroCitas se ha eliminado por completo de este equipo."
  exit 0
fi

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
dc pull
dc up -d
. ./.env
url="${PUBLIC_URL:-https://$DOMAIN}"
say "¡Listo! AstroCitas está en:  $url"
echo
echo "  1. Abre $url en el navegador y crea tu cuenta de administrador."
echo "  2. En la app: «Conectar a mi servidor» → escribe  $url"
case "$url" in http://*)
  echo
  echo "  Sin dominio funciona en tu red local (wifi de casa o del negocio)."
  echo "  Si la IP del equipo cambia, edita PUBLIC_URL en $DIR/.env y ejecuta: ${SUDO:+sudo }docker compose up -d"
  echo "  Consejo: fija la IP del equipo en el router (reserva DHCP).";;
esac
echo
echo "  Comprobación: curl -fsS $url/health"
echo "  Eliminarlo todo:  curl -fsSL $BASE/install.sh | sh -s -- --uninstall"
if [ -n "$SUDO" ]; then
  echo
  echo "  Para usar Docker sin sudo:  sudo usermod -aG docker \$USER  (y vuelve a iniciar sesión)"
fi
