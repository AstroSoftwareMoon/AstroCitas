// Desarrollo: ejecuta el servidor TypeScript directamente (Node ≥ 22.6 con --experimental-strip-types).
process.env.ASTRO_SECRET ??= 'dev-secret-dev-secret-dev-secret-123';
process.env.DATA_DIR ??= './data';
process.env.PUBLIC_URL ??= 'http://localhost:8080';
await import('../src/index.ts');
