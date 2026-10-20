const { test, expect, session } = require('./fixtures');

const READY = { available: true, ready: true, version: '5.1.22621', home: '/mnt/c/Users/me', windows_home: 'C:\\Users\\me', agents: ['claude', 'codex'] };

async function windowsComputer(page, status = READY) {
  const moves = [];
  await page.route('https://panel.test/api/windows_status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ windows: status }) }));
  await page.route('https://panel.test/api/session_move', route => {
    moves.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'audit-win', summary: true }) });
  });
  await page.route('https://panel.test/api/session_info*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ supported: true, context: null, summary: null, started: null }) }));
  return moves;
}

test('a new session can run its agent in Windows, in a folder of the Windows user', async ({ app, page }) => {
  await windowsComputer(page);
  await app.open();
  await page.evaluate(() => openNew());
  await expect(page.locator('#n_runtime_row')).toBeVisible();
  await expect(page.locator('#n_proj')).toBeVisible();
  await page.locator('#n_runtime [data-runtime="windows"]').click();
  // Git, GitHub and the project folder belong to WSL; a Windows session gets a Windows folder instead.
  await expect(page.locator('#n_proj')).toBeHidden();
  await expect(page.locator('#n_adv')).toBeHidden();
  await page.locator('#n_name').fill('audit');
  await expect(page.locator('#n_winpath')).toHaveAttribute('placeholder', 'C:\\Users\\me\\audit');
  await expect(page.locator('#n_win_hint')).toContainText('PowerShell 5.1.22621');
  await expect(page.locator('#n_win_hint')).toContainText('без прав администратора');
  // A Claude account or model left picked for WSL is hidden here and not sent.
  await page.evaluate(() => { const s = $('n_source'); s.add(new Option('GLM', '{"kind":"provider","provider":"glm"}')); s.value = s.options[s.options.length - 1].value; });
  await page.locator('#n_go').click();
  await expect.poll(() => app.newSessions.at(-1)).toMatchObject({ name: 'audit', agent: 'claude', runtime: 'windows', windows_path: 'C:\\Users\\me\\audit' });
  expect(app.newSessions.at(-1).source).toBeUndefined();
  expect(app.newSessions.at(-1).containers).toBeUndefined();
});

test('a computer whose WSL runs elevated says the agent runs as administrator', async ({ app, page }) => {
  await windowsComputer(page, { ...READY, admin: true });
  await app.open();
  await page.evaluate(() => openNew());
  await page.locator('#n_runtime [data-runtime="windows"]').click();
  await expect(page.locator('#n_win_hint')).toContainText('от имени администратора');
});

test('a computer without Windows offers no choice and sends none', async ({ app, page }) => {
  await windowsComputer(page, { available: false });
  await app.open();
  await page.evaluate(() => openNew());
  await page.locator('#n_name').fill('plain');
  await page.waitForTimeout(300);
  await expect(page.locator('#n_runtime_row')).toBeHidden();
  await page.locator('#n_go').click();
  await expect.poll(() => app.newSessions.at(-1)?.name).toBe('plain');
  expect(app.newSessions.at(-1).runtime).toBeUndefined();
});

test('a session moves to Windows in a new one and the Windows one is marked', async ({ app, page }) => {
  const moves = await windowsComputer(page);
  app.sessions = [session('audit', { agent: 'claude', path: '/mnt/c/Users/me/win11' }), session('audit-win', { agent: 'claude', path: '/mnt/c/Users/me/win11', runtime: 'windows' })];
  await app.open({ active: 'audit' });
  await page.evaluate(() => sheet(true));
  await expect(page.locator('#s_move')).toBeVisible();
  await expect(page.locator('#s_move')).toContainText('Перенести в Windows');
  await page.locator('#s_move').click();
  await expect(page.locator('#move_dlg')).toBeVisible();
  await expect(page.locator('#move_path')).toHaveValue('C:\\Users\\me\\win11');
  await expect(page.locator('#move_dlg')).toContainText('История не переносится');
  await page.locator('#move_dlg .pri').click();
  await expect.poll(() => moves.at(-1)).toEqual({ name: 'audit', runtime: 'windows', windows_path: 'C:\\Users\\me\\win11' });
  await expect(page.locator('#title b')).toContainText('audit-win');
  await expect(page.locator('#session_runtime_box')).toBeVisible();
  await page.evaluate(() => sheet(true));
  await expect(page.locator('#s_move')).toContainText('Перенести в Linux (WSL)');
});
