import { expect, test } from '@playwright/test';

test('modo local: onboarding, crear cita en 3 toques, persistencia y anti doble reserva', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByTestId('mode-local').click();
  await page.getByTestId('onb-name').fill('Barbería Orión');
  await page.getByRole('button', { name: 'Barbería' }).click();
  await page.getByRole('switch').click(); // sin datos de ejemplo
  await page.getByTestId('onb-start').click();

  await expect(page.getByTestId('cal-title')).toBeVisible();
  await page.getByRole('tab', { name: 'Día' }).click();

  // Ir al próximo lunes para tener jornada laborable
  const next = page.getByRole('button', { name: 'Siguiente' });
  for (let i = 0; i < 7; i++) {
    if (/^lun/i.test((await page.getByTestId('cal-title').textContent()) ?? '')) break;
    await next.click();
  }
  await expect(page.getByTestId('cal-title')).toContainText(/^lun/i);

  // Nueva cita: servicio → hueco → cliente
  await page.getByRole('button', { name: 'Nueva cita' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Corte \+ barba/ }).click();
  await dialog.getByTestId('slots').getByRole('button', { name: '10:00' }).click();
  await dialog.getByTestId('client-search').fill('Lucía Pérez');
  await dialog.getByTestId('client-create').click();
  await dialog.getByPlaceholder('Teléfono').fill('+34 600 123 456');
  await dialog.getByTestId('appt-save').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('appt')).toHaveCount(1);
  await expect(page.getByTestId('appt').first()).toContainText('Lucía Pérez');

  // Doble reserva: el hueco de las 10:00 ya no se ofrece y forzar la hora da error
  await page.getByRole('button', { name: 'Nueva cita' }).first().click();
  await dialog.getByRole('button', { name: /^Corte\b/ }).first().click();
  await expect(dialog.getByTestId('slots').getByRole('button', { name: '10:00', exact: true })).toHaveCount(0);
  await dialog.getByTestId('appt-time').fill('10:15');
  await dialog.getByTestId('appt-save').click();
  await expect(dialog.getByRole('alert')).toContainText('ya tiene una cita');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  // Persistencia tras recargar (SQLite en OPFS)
  await page.reload();
  await expect(page.getByTestId('cal-title')).toBeVisible();
  await page.goto('/#/clients');
  await expect(page.getByText('Lucía Pérez')).toBeVisible();

  expect(errors).toEqual([]);
});

test('datos de ejemplo y navegación por todas las pantallas', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('mode-local').click();
  await page.getByTestId('onb-name').fill('Clínica Andrómeda');
  await page.getByRole('button', { name: 'Fisioterapia' }).click();
  await page.getByTestId('onb-start').click();
  await page.getByRole('tab', { name: 'Semana' }).click();
  await expect(page.getByTestId('appt').first()).toBeVisible({ timeout: 15_000 });
  for (const hash of ['#/clients', '#/services', '#/staff', '#/settings']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('h1').first()).toBeVisible();
  }
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('switch', { name: 'Reducir transparencia' }).click();
  await expect(page.locator('html')).toHaveClass(/no-glass/);
});
