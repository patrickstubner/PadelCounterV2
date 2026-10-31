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
  for (const size of [
    { width: 390, height: 780 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(size);
    const fits = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
    expect(fits).toBe(true);
  }
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
    return { phone: read('.phone-count'), burger: read('.menu-toggle'), bar: read('.top-actions .text-btn') };
  });
  expect(shape.phone).toBe('0.7rem');
  expect(shape.burger).toBe('0.7rem');
  expect(shape.bar).toBe('0.7rem');
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect(page.getByTestId('menu-toggle')).toHaveCount(0);
  const corners = await page.locator('.top-actions .text-btn').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    const radius = Number.parseFloat(getComputedStyle(node).borderTopLeftRadius);
    return { radius, height: box.height, pill: radius >= box.height / 2 - 0.5 };
  }));
  expect(corners.length).toBeGreaterThan(0);
  for (const corner of corners) {
    expect(corner.pill).toBe(false);
    expect(corner.radius).toBeGreaterThan(8);
    expect(corner.height).toBeGreaterThan(40);
  }
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByTestId('menu-toggle').click();
  const version = page.getByTestId('app-version');
  await expect(version).toBeVisible();
  await expect(version).toHaveText(/^v2\.3\.2$/);
  const size = await version.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

test('wide landscape header labels stay inside the button', async ({ page }) => {
  for (const size of [
    { width: 932, height: 430 },
    { width: 1100, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.getByTestId('menu-toggle')).toHaveCount(0);
    const header = await page.locator('.top').boundingBox();
    expect(header).not.toBeNull();
    if (!header) continue;
    expect(header.height).toBeGreaterThan(60);
    for (const id of ['fanfare-toggle', 'haptic-toggle'] as const) {
      const button = page.getByTestId(id);
      await expect(button).toBeVisible();
      const fit = await button.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          inside: text.top >= box.top - 0.5
            && text.bottom <= box.bottom + 0.5
            && text.left >= box.left - 0.5
            && text.right <= box.right + 0.5,
          height: box.height,
          minHeight: Number.parseFloat(style.minHeight),
          label: node.textContent,
        };
      });
      expect(fit.label === 'Victory sound: On' || fit.label === 'Haptic feedback: On').toBe(true);
      expect(fit.inside, `${size.width}x${size.height} ${fit.label}`).toBe(true);
      expect(fit.height).toBeGreaterThanOrEqual(fit.minHeight - 0.5);
    }
  }
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
