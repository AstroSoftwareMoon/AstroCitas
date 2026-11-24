// Genera los iconos de Android (adaptativos + heredados) a partir de la marca.
// Uso: node scripts/render-android-icons.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'apps/client/src-tauri/icons/android');
const maskable = readFileSync(resolve(root, 'assets/brand/app-icon-maskable.svg'), 'utf8');
const rounded = readFileSync(resolve(root, 'assets/brand/app-icon.svg'), 'utf8');
// Primer plano adaptativo: el planeta sin fondo (ya está dentro de la zona segura del 66 %)
const foreground = maskable.replace('<rect width="64" height="64" fill="#000"/>', '');
// Icono redondo: el mismo diseño recortado en círculo
const round = maskable
  .replace('<rect width="64" height="64" fill="#000"/>', '<circle cx="32" cy="32" r="32" fill="#000"/>');

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`);
  mkdirSync(dirname(file), { recursive: true });
  await page.locator('svg').screenshot({ path: file, omitBackground: true });
}
for (const [d, k] of Object.entries(densities)) {
  const dir = `${out}/mipmap-${d}`;
  await render(foreground, 108 * k, `${dir}/ic_launcher_foreground.png`);
  await render(rounded, 48 * k, `${dir}/ic_launcher.png`);
  await render(round, 48 * k, `${dir}/ic_launcher_round.png`);
  console.log('✓', d);
}
await browser.close();
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
writeFileSync(`${out}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
writeFileSync(`${out}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);
writeFileSync(`${out}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#000000</color>
</resources>
`);
