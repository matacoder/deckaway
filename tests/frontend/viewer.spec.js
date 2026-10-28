const { test, expect } = require('./fixtures');
const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1179" height="2556"><rect width="1179" height="2556" fill="#9c3"/></svg>');

test('a phone closes a picture with the button or a swipe down', async ({ app, page }) => {
  await app.open({ width: 390, height: 844 });
  const show = () => page.evaluate(url => showViewer([{ url, name: 'shot.png', title: 'shot.png' }], 0), picture);
  await show();
  await expect(page.locator('#viewer_close')).toBeInViewport();
  await expect(page.locator('#viewer_open')).toBeInViewport();
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/viewer-phone.png' });
  await page.locator('#viewer_close').click();
  await expect(page.locator('#viewer')).toBeHidden();
  await show();
  await page.evaluate(() => {
    const viewer = document.getElementById('viewer');
    // WebKit has no Touch constructor: a plain event carries the touch lists the viewer reads.
    const touch = (type, touches, y) => viewer.dispatchEvent(Object.assign(new Event(type, { bubbles: true }),
      { touches, changedTouches: [{ clientX: 200, clientY: y }] }));
    touch('touchstart', [{ clientX: 200, clientY: 300 }], 300);
    touch('touchend', [], 500);
  });
  await expect(page.locator('#viewer')).toBeHidden();
});
