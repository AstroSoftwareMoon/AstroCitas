# Autohospedar AstroCitas (modo B)

Tu servidor, tus datos. El servidor añade a la app:

- Varios dispositivos sincronizados, que siguen funcionando sin conexión.
- Equipo con roles: propietario, recepción y profesional.
- Reserva online con huecos en tiempo real, más un widget para tu web.
- Recordatorios automáticos 24/7 por email, WhatsApp o SMS, con **tus** credenciales.
- Calendario suscribible `.ics` y copias de seguridad programadas.

Requisitos mínimos: 1 vCPU, 512 MB de RAM y 1 GB de disco. Funciona en una Raspberry Pi 4 o 5 (arm64).

---

## 1. Instalación en un comando (VPS o Raspberry Pi)

```bash
curl -fsSL https://github.com/AstroSoftwareMoon/AstroCitas/releases/latest/download/install.sh | sh
```

El script hace lo siguiente:

1. Instala Docker si no está.
2. Descarga `docker-compose.yml`, `Caddyfile` y `.env.example` en `~/astrocitas`.
3. Genera un `ASTRO_SECRET` aleatorio y te pregunta el dominio.
4. Arranca **AstroCitas + Caddy**. Caddy obtiene y renueva el certificado HTTPS de Let's Encrypt automáticamente.

Antes de lanzarlo, apunta un registro DNS `A`/`AAAA` de tu dominio (p. ej. `citas.tudominio.es`) a la IP del servidor y abre los puertos 80 y 443.

Al terminar, abre `https://citas.tudominio.es`, elige **Conectar a mi servidor** y crea la cuenta de administrador. Si ya usabas la app en modo local, el asistente te ofrece subir tus datos al servidor (se fusionan sin pérdidas y se verifica el recuento).

## 2. Instalación manual con Docker Compose

```bash
mkdir astrocitas && cd astrocitas
curl -fsSLO https://github.com/AstroSoftwareMoon/AstroCitas/releases/latest/download/docker-compose.yml
curl -fsSLO https://github.com/AstroSoftwareMoon/AstroCitas/releases/latest/download/Caddyfile
curl -fsSL https://github.com/AstroSoftwareMoon/AstroCitas/releases/latest/download/env.example -o .env
nano .env            # DOMAIN y ASTRO_SECRET (openssl rand -hex 32)
docker compose up -d
curl -fsS https://citas.tudominio.es/health
```

### PostgreSQL y Redis (opcionales)

SQLite es más que suficiente para uno o varios negocios pequeños. Para instalaciones grandes:

```bash
# en .env: DATABASE_URL=postgres://astrocitas:CONTRASEÑA@postgres:5432/astrocitas
#          REDIS_URL=redis://redis:6379
docker compose --profile postgres --profile redis up -d
```

Con PostgreSQL cada negocio vive en su propio esquema. Con Redis, la cola de recordatorios usa BullMQ en lugar de la cola integrada en la base de datos.

## 3. NAS (Synology, QNAP, Unraid, TrueNAS)

- **Synology DSM 7 (Container Manager):** *Proyecto → Crear*. Pega `docker-compose.yml`, crea el `.env` en la misma carpeta y arranca. Si ya usas el proxy inverso de DSM, elimina el servicio `caddy` y apunta el proxy a `astrocitas:8080`.
- **Unraid:** *Docker → Add container*:
  - Repository `ghcr.io/astrosoftwaremoon/astrocitas-server:latest`.
  - Puerto `8080`.
  - Volumen `/mnt/user/appdata/astrocitas:/data`.
  - Variables `ASTRO_SECRET` y `PUBLIC_URL`.
- **Sin dominio, solo en tu red local:** usa `PUBLIC_URL=http://IP-DEL-NAS:8080` y publica el puerto 8080. Las apps se conectan igual. La reserva online solo funcionará dentro de tu red.

## 4. Configuración (`.env`)

| Variable | Por defecto | Para qué |
|---|---|---|
| `ASTRO_SECRET` | — (obligatoria) | ≥ 32 caracteres. Firma sesiones y enlaces y cifra las credenciales de mensajería |
| `DOMAIN` / `PUBLIC_URL` | — | Dirección pública (enlaces de reserva, recordatorios, `.ics`) |
| `DATABASE_URL` | vacío = SQLite | `postgres://…` para PostgreSQL |
| `REDIS_URL` | vacío = cola en BD | `redis://…` para BullMQ |
| `CAPTCHA` | `true` | Prueba de trabajo ALTCHA en la reserva pública (autoalojada, sin terceros) |
| `ALLOW_REGISTRATION` | `false` | Solo el administrador invita usuarios |
| `UPDATE_CHECK` | `true` | Aviso en el panel cuando hay versión nueva (consulta GitHub Releases) |
| `CORS_ORIGINS` | `*` | Orígenes permitidos para la API |
| `LOG_LEVEL` | `info` | Logs estructurados JSON (`debug`, `info`, `warn`, `error`) |
| `TRUST_PROXY` | `true` | Detrás de Caddy/Nginx (IP real para límites de peticiones y auditoría) |

Endpoint de salud: `GET /health` → `{"status":"ok","version":"…","db":"sqlite"}`.

## 5. Mensajería con tus credenciales

Se configura en la app, en **Servidor → Mensajería**. Las credenciales se guardan cifradas (AES-256-GCM) y nunca se muestran de nuevo.

| Canal | Proveedor | Qué necesitas |
|---|---|---|
| Email | SMTP | Servidor, puerto (587 STARTTLS / 465 TLS), usuario, contraseña, remitente |
| Email | Resend | API key y remitente verificado |
| WhatsApp | WhatsApp Cloud API (Meta) | `phoneNumberId`, token permanente y, para mensajes fuera de la ventana de 24 h, una plantilla aprobada (`templateName`) |
| SMS | Twilio | Account SID, Auth Token y número o Messaging Service |

**WhatsApp: botones y estado de entrega.**

1. En Meta for Developers, configura el webhook `https://citas.tudominio.es/webhooks/whatsapp/<ID-de-negocio>`.
2. Usa el *verify token* que pusiste en AstroCitas.
3. Suscríbete a `messages`.

Las respuestas **Confirmo / Cancelar** actualizan la cita al instante y los estados *entregado / leído* aparecen en el historial. En email y SMS los botones son enlaces firmados. Al abrirlos se pide pulsar un botón, para que los antivirus que abren enlaces no cancelen citas.

Las reglas de recordatorio (24 h y 2 h antes, confirmación al reservar, agradecimiento, reseña) se editan en **Mensajes → Automático**:

- La cola reintenta con backoff exponencial.
- No duplica mensajes (idempotencia).
- Si una cita se mueve o se cancela, el recordatorio pendiente se descarta y se programa uno nuevo.

## 6. Copias de seguridad y restauración

- **Automáticas:** cada día a la hora elegida (**Servidor → Copias**), en `/data/backups/<negocio>/`. Por defecto se conservan 14.
- **Manual:** botón *Hacer copia ahora* y descarga del archivo `.astrocitas`.
- **Volumen completo:** `docker run --rm -v astrocitas_astrocitas-data:/data -v $PWD:/out alpine tar czf /out/astrocitas-data.tgz /data`.
- **Restaurar:** sube el `.astrocitas` desde la app (Ajustes → Restaurar copia), en local o conectado.

## 7. Actualizar

```bash
cd ~/astrocitas && docker compose pull && docker compose up -d
```

Las migraciones de base de datos son versionadas y se aplican solas al arrancar. Haz una copia antes de cada actualización importante. Si fijas `ASTROCITAS_VERSION` en `.env`, controlas cuándo se actualiza. Verifica la imagen con los checksums de la release (`SHA256SUMS.txt`).

## 8. Seguridad

- **Contraseñas:** argon2id.
- **Sesiones:** JWT de 15 min y refresh token rotatorio. Si se reutiliza un token antiguo, se revocan todas las sesiones del usuario.
- **2FA** con TOTP (Servidor → Cuenta).
- **Roles:**
  - *propietario*: todo;
  - *recepción*: citas y clientes;
  - *profesional*: solo sus citas, también al sincronizar.
- **Auditoría** de cada cambio (quién, qué, cuándo, IP).
- **Límites de peticiones** por IP (login, reserva pública) y CAPTCHA ALTCHA.
- **HTTPS** obligatorio con Caddy (HSTS).
