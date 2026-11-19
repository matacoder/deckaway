const { test, expect, session } = require('./fixtures');

const decision = (id, extra = {}) => ({ id, session: 'demo', key: 'k-' + id, question: 'Добавить индекс сейчас или после релиза, когда нагрузка спадёт?',
  context: 'Запрос списка заказов идёт 4 с. Индекс строится 10 минут и блокирует запись.', options: ['Сейчас', 'После релиза'],
  status: 'open', answer: '', asked: 1800000000, sent: null, folder: '/home/demo/p', live: true, title: 'demo', ...extra });

test('questions from agents are answered and sent from the side panel on a phone', async ({ app, page }) => {
  app.sessions = [session('demo', { agent: 'claude', decisions: 2 })];
  app.decisions = [decision('a'), decision('b', { options: [] })];
  await app.open({ width: 390, height: 844, active: 'demo' });
  await page.evaluate(() => openProject('decisions'));
  const cards = page.locator('#decisions_body .dec-card');
  await expect(cards).toHaveCount(2);
  const body = page.locator('#decisions_body');
  expect(await body.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  // iOS zooms into a field under 16 px.
  expect(await cards.first().locator('textarea').evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  await cards.first().getByRole('button', { name: 'После релиза' }).click();
  await cards.nth(1).locator('textarea').fill('Не сейчас');
  await page.locator('#decisions_body .dec-footer button').click();
  await expect.poll(() => app.decisionSends).toEqual([['a', 'b']]);
  await expect(page.locator('#decisions_body .dec-card.sent')).toHaveCount(2);
});

test('the folder path in Files has a line of its own above its buttons', async ({ app, page }) => {
  app.sessions = [session('demo', { agent: 'claude' })];
  await app.open({ width: 390, height: 844, active: 'demo' });
  await page.evaluate(() => {
    files.session = active; files.listing = { path: '/home/demo/projects/agent-deck/frontend', home: '/home/demo', parent: '/home/demo/projects/agent-deck',
      entries: [{ name: 'app.js', dir: false, size: 10 }] };
    $('project_dlg').open || openProject('files'); files.session = active; renderFiles();
  });
  const crumbs = await page.locator('#files_body .files-crumbs').boundingBox(), up = await page.locator('#files_body .files-up').first().boundingBox();
  expect(crumbs.y + crumbs.height).toBeLessThanOrEqual(up.y + 1);
});
