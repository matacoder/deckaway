const { test, expect, session } = require('./fixtures');

test("Claude's suggested next step is a button that sends it", async ({ app, page }) => {
  const screen = '● Готово.\n────────\n\x1b[39m❯ \x1b[2mпуш и выкат\x1b[0m\n────────\n';
  app.sessions = [session('demo', { agent: 'claude', preview_ansi: screen }), session('shell', { agent: 'shell', preview_ansi: screen })];
  await app.open({ width: 390, height: 844, active: 'demo' });
  await expect(page.locator('#suggest_chip')).toBeVisible();
  await expect(page.locator('#suggest_text')).toHaveText('пуш и выкат');
  await page.locator('#suggest_chip').click();
  await expect.poll(() => app.sends.at(-1)).toMatchObject({ name: 'demo', text: 'пуш и выкат' });
  await expect(page.locator('#suggest_chip')).toBeHidden();
  // Only Claude suggests: the same dim text in a terminal is not offered.
  await page.evaluate(() => select('shell'));
  await expect(page.locator('#suggest_chip')).toBeHidden();
});

test('on a wide window the suggestion sits under the keys, which keep the quick prompts on their row', async ({ app, page }) => {
  const screen = '● Готово.\n────────\n\x1b[39m❯ \x1b[2mпуш и выкат\x1b[0m\n────────\n';
  app.sessions = [session('demo', { agent: 'claude', preview_ansi: screen })];
  await app.open({ width: 1280, height: 800, active: 'demo' });
  await page.evaluate(() => { quick.saved = [{ label: 'Тесты', text: 'run the tests' }]; fitKeyRow(); });
  await expect(page.locator('#suggest_chip')).toBeVisible();
  await expect(page.locator('#quick_prompts .quick-chip').first()).toBeVisible();
  const keys = await page.locator('#screen_keys').boundingBox(), quick = await page.locator('#quick_prompts .quick-chip').first().boundingBox();
  const chip = await page.locator('#suggest_chip').boundingBox();
  // The quick prompts (and their pencil) stay beside the keys instead of a row of its own under the suggestion.
  expect(quick.y).toBeLessThan(keys.y + keys.height);
  expect(chip.y).toBeGreaterThanOrEqual(keys.y + keys.height - 1);
});
