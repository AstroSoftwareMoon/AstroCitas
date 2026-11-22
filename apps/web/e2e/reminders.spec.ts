import { expect, test } from '@playwright/test';

test('fase 2: recordatorio por WhatsApp en 1 toque, plantillas y página de solicitud', async ({ page, context }) => {
  await page.goto('/');
  await page.getByTestId('mode-local').click();
  await page.getByTestId('onb-name').fill('Estética Vega');
  await page.getByRole('button', { name: 'Estética' }).click();
  await page.getByTestId('onb-start').click();
  await expect(page.getByTestId('cal-title')).toBeVisible({ timeout: 20_000 });

  // Pendientes: mañana hay citas de ejemplo con cliente y teléfono
  await page.goto('/#/messages');
  const list = page.getByTestId('pending-list');
  await expect(list.locator('li').first()).toBeVisible({ timeout: 15_000 });
  const before = await list.locator('li').count();
  await context.route('https://wa.me/**', (r) => r.fulfill({ body: 'whatsapp' }));
  const popupPromise = context.waitForEvent('page');
  await list.locator('li').first().getByTestId('send-whatsapp').click();
  const popup = await popupPromise;
  await popup.waitForURL(/wa\.me\/34\d{9}\?text=/);
  await popup.close();
  await expect(list.locator('li')).toHaveCount(before - 1);

  // Plantillas: vista previa en vivo
  await page.getByRole('tab', { name: 'Plantillas' }).click();
  await page.getByTestId('tpl-body').fill('Hola {nombre}, te esperamos a las {hora}');
  await expect(page.getByTestId('tpl-preview')).toContainText('Hola Lucía, te esperamos a las');

  // Historial
  await page.getByRole('tab', { name: 'Historial' }).click();
  await expect(page.getByText('Abierto').first()).toBeVisible();

  // Modo solicitud: requiere teléfono del negocio
  await page.goto('/#/settings');
  await page.getByLabel('Teléfono').first().fill('600 123 456');
  await page.getByRole('button', { name: 'Guardar' }).first().click();
  await expect(page.getByTestId('request-qr').locator('svg')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('download-request-page').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('reserva.html');
});
