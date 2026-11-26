import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Servidor sin dominio (instalador → Intro): se usa por http://IP-local. El navegador no lo considera
 * «contexto seguro» (sin OPFS, crypto.randomUUID ni crypto.subtle) y aun así todo debe funcionar.
 */
const ip = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://${ip}:${PORT}`;
let srv: ChildProcess;

test.describe.configure({ mode: 'serial' });
test.skip(!ip, 'sin interfaz de red no local');

test.beforeAll(async () => {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
  srv = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', join(root, 'apps/server/dist/server.mjs')], {
    env: {
      ...process.env,
      ASTRO_SECRET: 'e2e-secret-e2e-secret-e2e-secret-lan1',
      DATA_DIR: mkdtempSync(join(tmpdir(), 'astro-lan-')),
      WEB_DIR: join(root, 'apps/web/dist'),
      PORT: String(PORT),
      PUBLIC_URL: BASE,
      UPDATE_CHECK: 'false',
      LOG_LEVEL: 'warn',
    },
    stdio: 'inherit',
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* aún arrancando */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('El servidor no arrancó');
});

test.afterAll(() => srv?.kill());

test('por http://IP: crear admin, usar la agenda y reservar con CAPTCHA', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'una vez basta');
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByTestId('mode-remote').click();
  await expect(page.getByTestId('server-url')).toHaveValue(BASE);
  await page.getByRole('button', { name: 'Comprobar' }).click();
  await page.getByTestId('setup-business').fill('Taller Robles');
  await page.getByTestId('login-email').fill('admin@robles.es');
  await page.getByTestId('login-password').fill('contraseña-segura-123');
  await page.getByTestId('login-submit').click();

  // Agenda contra el servidor: crear un cliente
  await page.goto(`${BASE}/#/clients`);
  await page.getByRole('button', { name: 'Nuevo cliente' }).first().click();
  await page.getByLabel('Nombre').fill('Cliente por IP');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Cliente por IP').first()).toBeVisible({ timeout: 15_000 });

  // Reserva pública con el CAPTCHA resuelto sin crypto.subtle
  const login = await (
    await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@robles.es', password: 'contraseña-segura-123' }) })
  ).json();
  const bid = login.memberships[0].businessId;
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.accessToken}` };
  await fetch(`${BASE}/api/v1/b/${bid}/rpc`, { method: 'POST', headers: auth, body: JSON.stringify({ method: 'saveStaff', args: [{ name: 'Dani', hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: 0, end: 1439 })) }] }) });
  await fetch(`${BASE}/api/v1/b/${bid}/rpc`, { method: 'POST', headers: auth, body: JSON.stringify({ method: 'saveService', args: [{ name: 'Revisión', durationMin: 30 }] }) });
  const pub = await (await fetch(`${BASE}/api/v1/b/${bid}/public`, { headers: auth })).json();
  expect(pub.bookingUrl.startsWith(BASE)).toBe(true);
  await page.goto(pub.bookingUrl);
  await page.locator('.opt').first().click();
  await page.locator('.day:not([disabled])').first().click();
  await page.locator('.chip:not([disabled])').last().click();
  await page.getByLabel('Nombre y apellidos').fill('Cliente Online');
  await page.getByLabel('Teléfono').fill('611 000 222');
  await page.locator('#k').check();
  await page.getByRole('button', { name: 'Reservar cita' }).click();
  await expect(page.getByTestId('booked')).toContainText('¡Cita reservada!', { timeout: 60_000 });

  // Personalizar la página de reservas desde la app (pestaña Reserva online)
  await page.goto(`${BASE}/#/server`);
  await page.getByRole('tab', { name: 'Reserva online' }).click();
  await page.getByTestId('look-title').fill('Pide cita en Robles');
  await page.getByRole('tab', { name: 'Claro' }).click();
  await page.getByLabel('Mostrar precios').click();
  await page.getByPlaceholder(/Cancelaciones con 24 h/).fill('Parking gratuito');
  await page.getByTestId('look-save').click();
  const preview = page.frameLocator('[data-testid="look-preview"]');
  await expect(preview.getByRole('heading', { name: 'Pide cita en Robles' })).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByText('Parking gratuito')).toBeVisible();
  const html = await (await fetch(pub.bookingUrl)).text();
  expect(html).toContain('class="light"');
  const info = await (await fetch(`${BASE}/api/v1/public/${pub.slug}`)).json();
  expect(info.booking).toEqual({ showPrices: false, chooseStaff: true });
  expect(errors).toEqual([]);
});
