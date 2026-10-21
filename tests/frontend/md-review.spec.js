const { test, expect, session } = require('./fixtures');

const PLAN = '# DB connections\n\nThe pool keeps 40 connections.\n\n- shrink the pool\n- alert the error bot\n';

async function planFile(page) {
  const asked = [];
  await page.route(/https:\/\/panel\.test\/api\/file\?/, route => {
    asked.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ path: '/home/test/projects/demo/plans/db.md', content: PLAN, hash: 'h', size: PLAN.length }) });
  });
  await page.route(/https:\/\/panel\.test\/api\/files\?/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    home: '/home/test', path: '/home/test/projects/demo/plans', parent: '/home/test/projects/demo', entries: [{ name: 'db.md', size: PLAN.length }] }) }));
  return asked;
}

test('a Markdown file on the screen opens rendered, takes comments on its lines and sends them as one review', async ({ app, page }) => {
  const asked = await planFile(page);
  app.sessions = [session('tmux', { agent: 'claude', preview: 'План записан в plans/db.md.' })];
  await app.open({ width: 1280, height: 900 });
  await page.locator('#pre a.file-link', { hasText: 'plans/db.md' }).click();
  await expect(page.locator('#files_body h1')).toHaveText('DB connections');
  expect(asked[0].get('name')).toBe('tmux');
  expect(asked[0].get('path')).toBe('plans/db.md');
  await page.locator('#files_body .review-toggle').click();
  await expect(page.locator('#files_body .review-hint')).toBeVisible();
  await page.locator('#files_body li', { hasText: 'alert the error bot' }).click();
  await page.locator('#files_body .review-area').fill('Which bot?');
  await page.locator('#files_body .review-edit .pri').click();
  await expect(page.locator('#files_body .review-note')).toContainText('Строка 6');
  await expect(page.locator('#files_body li.reviewed')).toHaveCount(1);
  await page.locator('#files_body p', { hasText: 'The pool keeps' }).click();
  await page.locator('#files_body .review-area').fill('Too many');
  await page.locator('#files_body .review-edit .pri').click();
  await expect(page.locator('#files_body .review-send')).toHaveText('Отправить ревью (2)');
  // Kept like a draft: a reload brings the notes back.
  await page.reload();
  await page.locator('#pre a.file-link', { hasText: 'plans/db.md' }).click();
  await expect(page.locator('#files_body .review-note')).toHaveCount(2);
  await page.locator('#files_body .review-send').click();
  await expect.poll(() => app.sends.at(-1)?.text).toContain('Review of /home/test/projects/demo/plans/db.md');
  const sent = app.sends.at(-1);
  expect(sent.name).toBe('tmux');
  expect(sent.text).toContain('Line 3: "The pool keeps 40 connections."\nToo many');
  expect(sent.text).toContain('Line 6: "- alert the error bot"\nWhich bot?');
  await expect(page.locator('#files_body .review-note')).toHaveCount(0);
});
