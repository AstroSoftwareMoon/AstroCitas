// Genera las capturas del README contra `pnpm --filter @astrocitas/web preview` (http://localhost:4173).
import { chromium, devices } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = (f) => resolve(dirname(fileURLToPath(import.meta.url)), '../docs/screenshots', f);
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const NOW = new Date('2026-11-19T11:40:00+01:00'); // jueves, para capturas reproducibles

async function setup(page, { dark = false } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.goto(BASE);
  await page.getByTestId('mode-local').click();
  await page.getByTestId('onb-name').fill('Estudio Luna');
  await page.getByRole('button', { name: 'Peluquería' }).click();
  await page.getByPlaceholder('Tu nombre').fill('Marta');
  await page.getByTestId('onb-start').click();
  await page.getByTestId('appt').first().waitFor({ timeout: 20000 });
}

const browser = await chromium.launch({ args: ['--lang=es-ES'] });

// Escritorio: semana, día, editor, mes, clientes, equipo
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(BASE);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('mode.png') });
  await page.getByTestId('mode-local').click();
  await page.getByTestId('onb-name').fill('Estudio Luna');
  await page.getByRole('button', { name: 'Peluquería' }).click();
  await page.getByPlaceholder('Tu nombre').fill('Marta');
  await page.waitForTimeout(200);
  await page.screenshot({ path: out('onboarding.png') });
  await page.getByTestId('onb-start').click();
  await page.getByTestId('appt').first().waitFor({ timeout: 20000 });
  await page.getByRole('tab', { name: 'Semana' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('week.png') });
  await page.getByRole('tab', { name: 'Día' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('day.png') });
  await page.getByTestId('new-appt').click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: /^Tinte/ }).click();
  await dlg.getByTestId('client-search').fill('Luc');
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('new-appointment.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Mes' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('month.png') });
  await page.goto(`${BASE}/#/clients`);
  await page.locator('a[href^="#/clients/"]').nth(2).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('clients.png') });
  await page.goto(`${BASE}/#/reports`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('reports.png') });
  await page.goto(`${BASE}/#/messages`);
  await page.getByRole('button', { name: 'Hoy' }).first().click().catch(() => undefined);
  await page.getByRole('tab', { name: 'Hoy' }).click().catch(() => undefined);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('messages.png') });
  await page.goto(`${BASE}/#/staff`);
  await page.getByRole('button', { name: /Marta/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('staff.png') });
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/#/settings`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('settings.png') });
  await ctx.close();
}

// Móvil
for (const dark of [false]) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'es-ES', timezoneId: 'Europe/Madrid', colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await setup(page, { dark });
  await page.getByRole('tab', { name: 'Día' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('mobile-day.png') });
  if (!dark) {
    await page.getByRole('button', { name: 'Nueva cita' }).last().click();
    await page.getByRole('dialog').getByRole('button', { name: /^Corte mujer/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: out('mobile-new.png') });
  }
  await ctx.close();
}

// Reserva online contra el servidor real (apps/server/dist), con datos de ejemplo.
{
  const { spawn } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const port = 8455;
  const srv = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'apps/server/dist/server.mjs'], {
    env: { ...process.env, ASTRO_SECRET: 'shots-secret-shots-secret-shots-1234', DATA_DIR: mkdtempSync(join(tmpdir(), 'astro-shots-')), PORT: String(port), UPDATE_CHECK: 'false', CAPTCHA: 'false', LOG_LEVEL: 'warn', WEB_DIR: 'apps/web/dist' },
    stdio: 'inherit',
  });
  const S = `http://localhost:${port}`;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${S}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const post = (path, body, tok) => fetch(S + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
  const s = await post('/api/v1/setup', { email: 'admin@luna.es', password: 'contraseña-segura-1', businessName: 'Estudio Luna', kind: 'peluqueria' });
  const bid = s.memberships[0].businessId;
  const rpc = (method, ...args) => post(`/api/v1/b/${bid}/rpc`, { method, args }, s.accessToken).then((r) => r.result);
  const hours = []; for (let wd = 1; wd <= 6; wd++) { hours.push({ weekday: wd, start: 570, end: 840 }); if (wd < 6) hours.push({ weekday: wd, start: 990, end: 1230 }); }
  await rpc('saveBusiness', { name: 'Estudio Luna', kind: 'peluqueria', address: 'C/ de la Luna 12, Madrid', phone: '+34 910 000 000' });
  for (const [n, c] of [['Marta', '#7c3aed'], ['Carlos', '#2563eb']]) await rpc('saveStaff', { name: n, color: c, hours });
  for (const [n, d, p] of [['Corte mujer', 45, 2500], ['Corte hombre', 30, 1500], ['Tinte', 90, 4500], ['Peinado', 30, 1800]]) await rpc('saveService', { name: n, durationMin: d, priceCents: p });
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const page = await ctx.newPage();
  await page.goto(`${S}/b/estudio-luna`);
  await page.locator('.opt').first().click();
  await page.locator('.day:not([disabled])').nth(1).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('booking.png') });
  await ctx.close();
  srv.kill();
}

await browser.close();
console.log('Capturas en docs/screenshots');
