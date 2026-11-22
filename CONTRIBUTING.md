# Contribuir a AstroCitas

¡Gracias! Unas reglas cortas:

1. La lógica de negocio va en `packages/core` (TypeScript puro, con tests). La UI no calcula huecos ni valida.
2. Nunca edites una migración publicada: añade una nueva en `packages/core/src/sql/migrations.ts`.
3. Textos visibles siempre con `t('clave')` en ES y EN (`packages/ui/src/i18n.tsx`).
4. Antes de abrir un PR: `pnpm typecheck && pnpm test && pnpm e2e`.
5. Las contribuciones se aceptan bajo AGPL-3.0-or-later con *sign-off* (DCO): `git commit -s`.
