const { test, expect, session } = require('./fixtures');

test('the light theme is drawn from the first paint, switches at once and recolours the screen', async ({ app, page }) => {
  await page.addInitScript(() => { if (localStorage.getItem('cc.theme') === null) localStorage.setItem('cc.theme', 'light'); });
  app.sessions = [session('demo', { agent: 'claude', preview_ansi: '\x1b[38;5;231mwhite on dark\x1b[39m\n' })];
  await app.open({ active: 'demo' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(251, 247, 241)');
  // Text an agent paints white for a dark terminal turns dark on the light page.
  await expect(page.locator('#pre span', { hasText: 'white on dark' })).toHaveCSS('color', 'rgb(20, 20, 20)');
  await page.evaluate(() => openSettings('app'));
  await page.locator('#ui_theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#pre span', { hasText: 'white on dark' })).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect(await page.evaluate(() => localStorage.getItem('cc.theme'))).toBe('dark');
});

test('every theme in the settings is drawn, and a light one recolours the screen', async ({ app, page }) => {
  app.sessions = [session('demo', { agent: 'claude', preview_ansi: '\x1b[38;5;231mwhite on dark\x1b[39m\n' })];
  await app.open({ active: 'demo' });
  await page.evaluate(() => openSettings('app'));
  await expect(page.locator('#ui_theme option')).toHaveCount(6);
  const backgrounds = { black: 'rgb(0, 0, 0)', dusk: 'rgb(35, 40, 56)', mint: 'rgb(242, 247, 246)' };
  for (const [theme, background] of Object.entries(backgrounds)) {
    await page.locator('#ui_theme').selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(background);
  }
  await expect(page.locator('#pre span', { hasText: 'white on dark' })).toHaveCSS('color', 'rgb(20, 20, 20)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mint');
});
