const { test, expect, session } = require('./fixtures');

const LONG = 'Bash command\n' + Array.from({ length: 40 }, (_, i) => `xcrun simctl spawn "$udid" defaults write -g AppleLocale en_GB # line ${i}`).join('\n');
const QUESTION = { id: 'q-long', title: LONG, options: [{ label: 'Yes', text: false }, { label: "Yes, and don't ask again", text: false }, { label: 'No', text: false }] };

test('a long command in a question leaves its answers on a phone screen, and an answered one does not come back', async ({ app, page }) => {
  const answers = [];
  await page.route(/https:\/\/panel\.test\/api\/question\?/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ question: QUESTION }) }));
  await page.route('https://panel.test/api/answer', route => { answers.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
  app.sessions = [session('demo', { agent: 'claude', preview: 'Bash command' })];
  await app.open({ width: 390, height: 844, active: 'demo' });
  const no = page.locator('#question .q-opt', { hasText: 'No' });
  await expect(no).toBeInViewport();
  // Opened, the text scrolls in its own box and the answers stay reachable.
  await page.locator('#question .q-title').click();
  await expect(page.locator('#question .q-title.open')).toBeVisible();
  await expect(no).toBeInViewport();
  await no.click();
  await expect.poll(() => answers.length).toBe(1);
  // The agent's screen still shows the question for a moment: the card stays gone.
  await expect(page.locator('#question')).toBeHidden();
  await page.evaluate(() => loadQuestion());
  await page.waitForTimeout(600);
  await expect(page.locator('#question')).toBeHidden();
});
