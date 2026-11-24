# Publicar una versión

```bash
# 1. Sube la versión en package.json (raíz) — Tauri la lee de ahí
# 2. Etiqueta y empuja
git tag v0.2.0 && git push origin v0.2.0
```

El workflow `.github/workflows/release.yml` hace todo lo siguiente:

1. Crea la release en borrador con un **changelog automático** a partir de los commits desde el tag anterior.
2. Compila y sube los artefactos:
   - **Windows:** `.msi`, `-setup.exe` (NSIS) y `-portable.exe`.
   - **macOS:** `.dmg` universal (Intel + Apple Silicon).
   - **Linux:** `.AppImage`, `.deb` y `.rpm`.
   - **Android:** `.apk` (firmado y alineado) y `.aab`.
   - **Web:** `astrocitas-web-X.Y.Z.zip` (PWA).
   - **Servidor:** imagen Docker `ghcr.io/<owner>/astrocitas-server:X.Y.Z` y `:latest` para `linux/amd64` y `linux/arm64`.
3. Ejecuta **smoke tests** de cada artefacto:
   - Linux: el `.deb` se instala y la app sigue viva 15 s; se valida el `.rpm`.
   - Windows: el `.exe` arranca.
   - macOS: `hdiutil verify` y binario universal.
   - Android: `apksigner verify`.
   - Web: el zip se sirve y responde.
   - Docker: el contenedor arranca y `/health` responde `ok`.
4. Genera `SHA256SUMS.txt` y publica la release. Si algún artefacto falla, se publica como *pre-release* para revisarla.

## Secretos (Settings → Secrets and variables → Actions)

Todos son opcionales: sin ellos la release se genera igual.

| Secreto / variable | Para qué | Cómo obtenerlo |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Firmar las actualizaciones automáticas de escritorio | `pnpm --filter @astrocitas/client tauri signer generate -w astrocitas.key` |
| **variable** `TAURI_UPDATER_PUBKEY` | Clave pública con la que la app verifica cada actualización | El `.pub` generado arriba |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Firma definitiva del APK/AAB | `keytool -genkeypair -v -keystore astrocitas.jks -alias astrocitas -keyalg RSA -keysize 4096 -validity 10000` y `base64 -w0 astrocitas.jks` |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Firmar y notarizar el `.dmg` | Cuenta de Apple Developer |

Sin `TAURI_SIGNING_PRIVATE_KEY` no se generan artefactos de actualización (la app no se autoactualiza, pero funciona). Sin keystore de Android, el APK se firma con una **clave de prueba**. Se puede instalar, pero una versión firmada después con la clave definitiva no podrá actualizarla: habrá que desinstalar antes. Sin certificado de Apple, el `.dmg` no va firmado: macOS pedirá *clic derecho → Abrir* la primera vez.

> ⚠️ Guarda la clave de firma de Android y la del actualizador en un lugar seguro. Si las pierdes, los usuarios tendrán que reinstalar a mano.

## Integridad

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

Las actualizaciones de escritorio se verifican con la firma minisign del actualizador de Tauri antes de instalarse.

## iOS

Ver [IOS.md](IOS.md).
