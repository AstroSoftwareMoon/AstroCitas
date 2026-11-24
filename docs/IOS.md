# iOS

El proyecto está preparado: Tauri 2 genera el proyecto Xcode con `pnpm --filter @astrocitas/client tauri ios init`, y el workflow `.github/workflows/ios.yml` lo compila. Ese workflow es manual (*Actions → iOS (manual) → Run workflow*).

**Firmar y distribuir en iPhone/iPad requiere una cuenta de Apple Developer (99 $/año).** Apple no permite instalar apps sin firmar fuera de su tienda o de TestFlight.

## Pasos

1. Crea un App ID (`app.astrocitas.client`), un certificado de distribución y un perfil de aprovisionamiento.
2. En GitHub crea:
   - la **variable** `APPLE_DEVELOPMENT_TEAM` (Team ID);
   - los **secretos** `APPLE_CERTIFICATE` (.p12 en base64), `APPLE_CERTIFICATE_PASSWORD` y `APPLE_PROVISIONING_PROFILE` (base64).
   - Para subir a TestFlight, además: `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` y `APPLE_API_KEY` (.p8 en base64).
3. Lanza el workflow eligiendo el método de exportación (`release-testing`, `app-store-connect` o `debugging`). El `.ipa` queda como artefacto.

En local, con un Mac: `pnpm --filter @astrocitas/client tauri ios dev` (simulador) o `tauri ios build`.

## Licencia y App Store

AstroCitas es AGPL-3.0. El titular del copyright puede publicarla en la App Store; si eres un tercero que redistribuye una versión modificada, revisa la compatibilidad de la AGPL con los términos de Apple.
