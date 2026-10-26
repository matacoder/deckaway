const { test, expect } = require('./fixtures');

test('a phone picks a project folder by its last change and the form fills in', async ({ app, page }) => {
  await app.open({ width: 390, height: 844 });
  await page.evaluate(() => openNew());
  const list = page.locator('#n_folders_list .repo');
  await expect(list).toHaveCount(3);
  await expect(page.locator('#n_folders_state')).toHaveText('Папки в ~/dev');
  expect(await list.locator('.rn').allTextContents()).toEqual(['teyes-cable', 'padel-bot', 'demo']);
  await page.locator('#n_folders_q').fill('pad');
  await expect(list).toHaveCount(1);
  await page.waitForTimeout(400);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/new-session-folders.png' });
  await list.first().click();
  await expect(page.locator('#n_proj')).toHaveValue('padel-bot');
  await expect(page.locator('#n_name')).toHaveValue('padel-bot');
  expect(await page.locator('#dlg').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
