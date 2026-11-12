const { test, expect, session } = require('./fixtures');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

test('several files are picked, all at once, and shared together as pictures, not as an archive', async ({ app, page }) => {
  const downloads = [];
  await page.route(/https:\/\/panel\.test\/api\/files\?/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    home: '/home/test', path: '/home/test/shots', parent: '/home/test',
    entries: [{ name: 'old', dir: true }, ...Array.from({ length: 30 }, (_, i) => ({ name: `shot-${i}.jpg`, size: JPEG.length })), { name: 'notes.txt', size: 5 }] }) }));
  await page.route(/https:\/\/panel\.test\/api\/download\?/, route => {
    downloads.push(new URL(route.request().url()).searchParams.get('path'));
    return route.fulfill({ contentType: 'application/octet-stream', body: JPEG });
  });
  await page.addInitScript(() => {
    window.shared = [];
    navigator.canShare = () => true;
    navigator.share = async data => { window.shared.push(data.files.map(file => [file.name, file.type])); };
  });
  app.sessions = [session('tmux', { agent: 'claude' })];
  await app.open({ width: 390, height: 844 });
  await page.evaluate(() => openProject('files'));
  await page.locator('#files_body .files-pick-toggle').click();
  await expect(page.locator('#files_body .files-download')).toHaveCount(0);
  await page.locator('#files_body .files-row', { hasText: 'shot-3.jpg' }).click();
  await expect(page.locator('#files_body .files-pick-count')).toContainText('1');
  await page.locator('#files_body .files-pick button', { hasText: 'Выбрать все' }).click();
  await expect(page.locator('#files_body .files-pick-count')).toContainText('31');
  await page.locator('#files_body .files-row', { hasText: 'notes.txt' }).click();
  await expect(page.locator('#files_body .files-pick-count')).toContainText('30');
  await page.locator('#files_body .files-pick button', { hasText: 'Поделиться' }).click();
  await expect.poll(() => page.evaluate(() => window.shared.length)).toBe(1);
  const shared = await page.evaluate(() => window.shared[0]);
  expect(shared).toHaveLength(30);
  expect(shared[0]).toEqual(['shot-0.jpg', 'image/jpeg']);
  expect(new Set(downloads).size).toBe(30);
  await page.locator('#files_body .files-pick button', { hasText: 'Снять выбор' }).click();
  await expect(page.locator('#files_body .files-pick button', { hasText: 'Поделиться' })).toBeDisabled();
});
