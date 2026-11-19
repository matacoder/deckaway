const { test, expect } = require('./fixtures');

test('background processes of agents are listed and stopped from the computers section', async ({ app, page }) => {
  app.leftovers = [
    { pid: 66008, session: '', closed: true, command: 'qemu-system-aarch64-headless -avd rezka-tv-test', age: 14 * 86400, rss: 7.4 * 1048576, count: 2 },
    { pid: 400, session: '', closed: true, command: 'node astro dev --port 4321', age: 3600, rss: 300 * 1024, count: 1 },
    { pid: 7200, session: 'padel', closed: false, command: 'sh -c run.sh', age: 600, rss: 2048, count: 3 },
  ];
  await app.open({ width: 390, height: 844 });
  await page.evaluate(() => openSettings('computers'));
  const card = page.locator('[data-card="leftovers"]');
  await expect(card.locator('#leftover_status')).toHaveText('Процессов: 3 · память: 7,7 ГБ');
  await expect(card.locator('.hub-row strong')).toHaveText(['Закрытая сессия', 'Закрытая сессия', 'padel']);
  expect(await page.locator('#settings_dlg').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await card.getByRole('button', { name: 'Остановить всё от закрытых сессий' }).click();
  await page.locator('#confirm_ok').click();
  await expect.poll(() => app.leftoverStops).toEqual([{ pids: [66008, 400] }]);
  await expect(card.locator('.hub-row strong')).toHaveText(['padel'], { timeout: 5000 });
});
