const { test, expect, session } = require('./fixtures');

const ANSWER = 'Отчёт: /home/test/projects/demo/reports/Коэффициенты 1,22 и 1,55 сверка.pdf\n' +
  'Скриншоты в screenshots/ — запусти `! npm run shots -- --all`.';

async function conversation(page) {
  await page.route('https://panel.test/api/session_info*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ supported: true, context: null, summary: null, started: null }) }));
  await page.route(/https:\/\/panel\.test\/api\/conversation\?/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    supported: true, turns: [{ role: 'user', text: 'Перенеси отчёт' }, { role: 'assistant', text: ANSWER }] }) }));
  const listed = [];
  await page.route(/https:\/\/panel\.test\/api\/files\?/, route => {
    listed.push(new URL(route.request().url()).searchParams.get('path'));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ home: '/home/test', path: listed.at(-1), parent: '/home/test', entries: [] }) });
  });
  return listed;
}

test('paths and commands of the last answer are chips that copy, open and run them whole', async ({ app, page }) => {
  const listed = await conversation(page);
  app.sessions = [session('demo', { agent: 'claude', path: '/home/test/projects/demo', preview: 'Отчёт: /home/test/projects/demo/reports/Коэффициен\nты 1,22 и 1,55 сверка.pdf' })];
  await app.open({ width: 390, height: 844 });
  const chips = page.locator('#answer_refs .ref-chip');
  await expect(chips).toHaveText(['npm run shots -- --all', 'Коэффициенты 1,22 и 1,55 сверка.pdf', 'screenshots/']);
  await chips.nth(1).click();
  await expect(page.locator('#ref_value')).toHaveText('/home/test/projects/demo/reports/Коэффициенты 1,22 и 1,55 сверка.pdf');
  await expect(page.locator('#ref_actions button')).toHaveText(['Копировать', 'Скачать']);
  await page.locator('#ref_dlg button', { hasText: 'Закрыть' }).click();
  // A folder named relative to the session opens in the file browser.
  await chips.nth(2).click();
  await page.locator('#ref_actions button', { hasText: 'Открыть папку' }).click();
  await expect.poll(() => listed.at(-1)).toBe('/home/test/projects/demo/screenshots');
  await page.evaluate(() => closeProject());
  // A command runs in a terminal of its own, in the session's folder, as it was written.
  await chips.nth(0).click();
  await page.locator('#ref_actions button', { hasText: 'Запустить в новом терминале' }).click();
  await expect.poll(() => app.newSessions.at(-1)).toMatchObject({ name: 'demo-run', agent: 'shell', path: '/home/test/projects/demo' });
  await expect.poll(() => app.sends.at(-1)).toMatchObject({ name: 'demo-run', text: 'npm run shots -- --all' });
  await expect(page.locator('#title b')).toContainText('demo-run');
});
