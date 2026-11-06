import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { width: 390, height: 780 },
  { width: 844, height: 390 },
  { width: 568, height: 320 },
] as const;

const HOST = 'hhhhhhhhhhhhhhhhhhhhhh';
const INVITE = 'iiiiiiiiiiiiiiiiiiiiii';
const MATCH = '11111111-1111-4111-8111-111111111111';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = 'http://localhost:4173';
  });
  const answerApi = async (route: { request: () => { url: () => string }; fulfill: (response: { status: number; contentType: string; body: string }) => Promise<void> }) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/invites')) {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          token: INVITE,
          code: 'K7M4-2QAB',
          expiresAt: Date.now() + 3_600_000,
        }),
      });
      return;
    }
    if (url.pathname === '/join') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ticket: 'zzzzzzzzzzzzzzzzzzzzzz' }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ matchId: MATCH, hostToken: HOST }),
    });
  };
  await page.route('**/matches', answerApi);
  await page.route('**/matches/**', answerApi);
  await page.route('**/join', answerApi);
});

for (const viewport of VIEWPORTS) {
  test(`the close control stays on screen at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/PadelCounterV2/');
    await page.getByTestId('menu-toggle').click();
    await page.getByTestId('connect-open').click();
    await page.getByTestId('show-qr').click();
    const dialog = page.getByTestId('connect-dialog');
    await page.getByTestId('share-code').waitFor();
    await dialog.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const close = page.getByTestId('connect-close-x');
    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    const overlay = await page.getByTestId('connect-backdrop').boundingBox();
    const sheet = await dialog.boundingBox();
    expect(overlay).not.toBeNull();
    expect(sheet).not.toBeNull();
    if (!overlay || !sheet) return;
    expect(sheet.x - overlay.x).toBeGreaterThanOrEqual(16);
    expect(overlay.x + overlay.width - (sheet.x + sheet.width)).toBeGreaterThanOrEqual(16);
    await close.click();
    await expect(dialog).toHaveCount(0);
  });
}
