// Empaqueta el servidor (incluido packages/core, que es TypeScript fuente) en un único ESM.
// Las dependencias npm quedan externas y se instalan en la imagen con `pnpm deploy --prod`.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})]
  .filter((d) => !d.startsWith('@astrocitas/'))
  // dependencias de packages/core
  .concat(['luxon', 'zod']);

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...external, ...external.map((e) => `${e}/*`)],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
console.log('✓ dist/server.mjs');
