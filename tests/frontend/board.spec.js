const { test, expect } = require('./fixtures');

const BOARD = {
  tmux: { tail: ['$ npm test', 'Tests: 42 passed'], summary: { line: 'Платёжный вебхук', done: 'Тесты проходят, жду ревью', at: 1, asks: false }, context: { tokens: 96000, level: 'heavy' } },
  other: { tail: ['Reading files…'], digest: { now: 'Читает конфиг и правит маршруты', at: 2 } },
  shell: { tail: ['dev@box:~$ make', 'ok'] },
};

test('the board shows every session as a tile, takes a reply and keeps its choices', async ({ app, page }) => {
  app.board = BOARD;
  await app.open();
  await page.locator('#b_board').click();
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#screen')).toBeHidden();
  await expect(page.locator('#b_board')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tile')).toHaveCount(3);
  const tmux = page.locator('.tile', { hasText: 'Тесты проходят, жду ревью' });
  await expect(tmux.locator('.tile-ctx')).toHaveText('96k');
  await expect(page.locator('.tile', { hasText: 'Читает конфиг и правит маршруты' })).toHaveCount(1);
  expect(app.boardRequests[0]).toContain('language=');

  await tmux.locator('.tile-reply textarea').fill('Запусти ещё раз');
  await tmux.locator('.tile-send').click();
  await expect.poll(() => app.sends.at(-1)).toEqual({ name: 'tmux', text: 'Запусти ещё раз', attachments: [] });
  await expect(tmux.locator('.tile-reply textarea')).toHaveValue('');

  await page.locator('#board_group').selectOption('none');
  await expect(page.locator('.board-group:not(.waiting) .board-group-head:visible')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#board_group')).toHaveValue('none');

  await page.locator('.tile', { hasText: 'Читает конфиг' }).locator('.tile-head').click();
  await expect(page.locator('#board')).toBeHidden();
  await expect(page.locator('#title b')).toHaveText('other');
});

test('a pinned tile goes first in its group and a draft survives a reload', async ({ app, page }) => {
  app.board = BOARD;
  await app.open();
  await page.locator('#b_board').click();
  const titles = () => page.locator('.board-group:not(.waiting) .tile-title').allTextContents();
  await expect.poll(titles).toEqual(['other', 'shell', 'tmux']);
  await page.locator('.tile', { hasText: 'shell' }).locator('.tile-pin').click();
  await expect.poll(titles).toEqual(['shell', 'other', 'tmux']);
  await page.locator('.tile', { hasText: 'other' }).locator('.tile-reply textarea').fill('Черновик');
  await page.reload();
  await expect(page.locator('.tile', { hasText: 'other' }).locator('.tile-reply textarea')).toHaveValue('Черновик');
});
