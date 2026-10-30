import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/PadelCounterV2/');
  await page.getByTestId('serve-cue').waitFor();
});

test('portrait uses the full height and keeps the version in the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.locator('.rules')).toBeHidden();
  await expect(page.locator('.court-foot')).toBeHidden();
  const board = await page.locator('.board').boundingBox();
  expect(board).not.toBeNull();
  if (!board) return;
  expect(board.y + board.height).toBeGreaterThan(770);
  await expect(page.getByTestId('serve-cue')).toHaveText('Please choose the serving team');
  await expect(page.getByTestId('serve-a')).toHaveClass(/is-cue/);
  await expect(page.getByTestId('serve-b')).toHaveClass(/is-cue/);
  const shape = await page.evaluate(() => {
    const read = (selector: string) => {
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule && rule.selectorText === selector) return rule.style.borderRadius;
        }
      }
      return '';
    };
    return { phone: read('.phone-count'), burger: read('.menu-toggle') };
  });
  expect(shape.phone).toBe('0.7rem');
  expect(shape.burger).toBe('0.7rem');
  await page.getByTestId('menu-toggle').click();
  const version = page.getByTestId('app-version');
  await expect(version).toBeVisible();
  await expect(version).toHaveText(/^v2\.3\.0$/);
  const size = await version.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

test('landscape keeps the rules and the menu version', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.rules')).toBeVisible();
  await expect(page.getByTestId('serve-cue')).toBeVisible();
  const board = await page.locator('.board').boundingBox();
  expect(board).not.toBeNull();
  if (!board) return;
  expect(board.height).toBeGreaterThan(200);
  await page.getByTestId('menu-toggle').click();
  const version = page.getByTestId('app-version');
  await expect(version).toBeVisible();
  const size = await version.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

test('reduced motion does not pulse the serve balls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.reload();
  await page.getByTestId('serve-cue').waitFor();
  const name = await page.getByTestId('serve-a').evaluate((node) => getComputedStyle(node).animationName);
  expect(name).toBe('none');
});

test('tie-break and the next set explain the serve, then the hint goes away', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByTestId('serve-a').click({ force: true });
  await expect(page.getByTestId('serve-cue')).toHaveCount(0);
  for (let game = 0; game < 6; game += 1) {
    await page.getByTestId('increment-a').click();
    await page.getByTestId('increment-b').click();
  }
  const tiebreak = page.getByTestId('tiebreak-hint');
  await expect(tiebreak).toBeVisible();
  await expect(tiebreak).toContainText('1 point from the right');
  await expect(tiebreak).toContainText('from the left');
  await expect(tiebreak).toContainText('2 points each');
  await expect(tiebreak).toContainText('every 6 points');
  await page.getByTestId('increment-a').click();
  const next = page.getByTestId('next-set-hint');
  await expect(next).toBeVisible();
  await expect(next).toContainText('did not start the tie-break');
  await expect(next).toContainText('choose which player');
  const text = (await next.textContent()) ?? '';
  const side = text.startsWith('Team B') ? 'b' : 'a';
  await page.getByTestId(`serve-${side}`).click({ force: true });
  await expect(page.getByTestId('next-set-hint')).toHaveCount(0);
  await expect(page.getByTestId('serve-cue')).toHaveCount(0);
  await expect(page.getByTestId('tiebreak-hint')).toHaveCount(0);
});
