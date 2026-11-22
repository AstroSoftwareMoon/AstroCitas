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

await browser.close();
console.log('Capturas en docs/screenshots');
