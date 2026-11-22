// Rasteriza los SVG de marca a PNG (iconos PWA, Tauri y README) con el Chromium preinstalado.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jobs = [
  ['assets/brand/app-icon.svg', 'assets/brand/app-icon-1024.png', 1024],
  ['assets/brand/app-icon.svg', 'apps/web/public/icons/icon-512.png', 512],
  ['assets/brand/app-icon.svg', 'apps/web/public/icons/icon-192.png', 192],
  ['assets/brand/app-icon.svg', 'apps/web/public/icons/apple-touch-icon.png', 180],
  ['assets/brand/app-icon-maskable.svg', 'apps/web/public/icons/icon-maskable-512.png', 512],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  const svg = readFileSync(resolve(root, src), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`);
  mkdirSync(dirname(resolve(root, out)), { recursive: true });
  await page.locator('svg').screenshot({ path: resolve(root, out), omitBackground: true });
  console.log('✓', out);
}
await browser.close();
