import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Modo B (autohospedado) contra el servidor real empaquetado (apps/server/dist), que además sirve la PWA.
 * Requiere: pnpm --filter @astrocitas/server build && pnpm --filter @astrocitas/web build
 */
const PORT = 8099 + (process.env.TEST_PARALLEL_INDEX ? Number(process.env.TEST_PARALLEL_INDEX) : 0);
let srv: ChildProcess;
const BASE = `http://localhost:${PORT}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
  srv = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', join(root, 'apps/server/dist/server.mjs')], {
    env: {
      ...process.env,
      ASTRO_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
      DATA_DIR: mkdtempSync(join(tmpdir(), 'astro-e2e-')),
      WEB_DIR: join(root, 'apps/web/dist'),
      PORT: String(PORT),
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

test('local → conectar a mi servidor → crear admin → migrar datos → panel del servidor', async ({ page }) => {
  test.setTimeout(150_000);
  // 1) Modo local con datos de ejemplo
  await page.goto(BASE);
  await page.getByTestId('mode-local').click();
  await page.getByTestId('onb-name').fill('Clínica Vega');
  await page.getByRole('button', { name: 'Clínica' }).click();
  await page.getByTestId('onb-start').click();
  await expect(page.getByTestId('cal-title')).toBeVisible({ timeout: 20_000 });

  // 2) Ajustes → Conectar a mi servidor (la URL se detecta sola: la PWA la sirve el propio servidor)
  await page.goto(`${BASE}/#/settings`);
  await page.getByTestId('connect-server').click();
  await expect(page.getByTestId('server-url')).toHaveValue(BASE);
  await page.getByRole('button', { name: 'Comprobar' }).click();
  await page.getByTestId('setup-business').fill('Clínica Vega');
  await page.getByTestId('login-email').fill('admin@vega.es');
  await page.getByTestId('login-password').fill('contraseña-segura-123');
  await page.getByTestId('login-submit').click();

  // 3) Migración verificada
  await page.getByTestId('migrate').click();
  await expect(page.getByText(/citas y \d+ clientes en tu servidor/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Abrir agenda' }).click();
  await expect(page.getByText(/Conectado a http:\/\/localhost/)).toBeVisible();
  await page.goto(`${BASE}/#/calendar`);

  // 4) La agenda ahora viene del servidor
  await page.getByRole('tab', { name: 'Semana' }).click();
  await expect(page.getByTestId('appt').first()).toBeVisible({ timeout: 15_000 });
  await page.goto(`${BASE}/#/server`);
  await expect(page.getByText('admin@vega.es')).toBeVisible();
  await page.getByRole('tab', { name: 'Reserva online' }).click();
  await expect(page.getByText(/\/b\/clinica-vega/)).toBeVisible();

  // 5) Los datos están en el servidor (API)
  const login = await (
    await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@vega.es', password: 'contraseña-segura-123' }) })
  ).json();
  const bid = login.memberships[0].businessId;
  const res = await (
    await fetch(`${BASE}/api/v1/b/${bid}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.accessToken}` }, body: JSON.stringify({ method: 'listClients', args: [] }) })
  ).json();
  expect(res.result.length).toBeGreaterThan(10);

  // 6) Offline-first: sin red se sigue trabajando y se sincroniza al volver
  if (test.info().project.name === 'desktop') {
    await page.context().setOffline(true);
    await page.getByRole('link', { name: 'Clientes' }).click();
    await page.getByRole('button', { name: 'Nuevo cliente' }).first().click();
    await page.getByLabel('Nombre').fill('Cliente sin conexión');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByTestId('sync-badge')).toContainText(/[1-9]\d* (pendientes|cambios por enviar)/, { timeout: 30_000 });
    await page.context().setOffline(false);
    await expect(async () => {
      await page.getByTestId('sync-badge').click();
      await expect(page.getByTestId('sync-badge')).toContainText('Sincronizado', { timeout: 3000 });
    }).toPass({ timeout: 40_000 });
    const after = await (
      await fetch(`${BASE}/api/v1/b/${bid}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.accessToken}` }, body: JSON.stringify({ method: 'listClients', args: [{ search: 'sin conexión' }] }) })
    ).json();
    expect(after.result).toHaveLength(1);
  }
});
