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
  const launch = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule && rule.selectorText === '.connect-launch') return rule.style.borderRadius;
      }
    }
    return '';
  });
  expect(launch).toBe('0.7rem');
  await page.getByTestId('menu-toggle').click();
  const version = page.getByTestId('app-version');
  await expect(version).toBeVisible();
  await expect(version).toHaveText(/^v2\.3\.4$/);
  const size = await version.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

test('landscape shows the menu, hides the footer, and keeps Connect beside the menu', async ({ page }) => {
  for (const size of [
    { width: 844, height: 390 },
    { width: 932, height: 430 },
    { width: 1100, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator('.rules')).toBeHidden();
    await expect(page.locator('.court-foot')).toBeHidden();
    await expect(page.getByTestId('serve-cue')).toBeVisible();
    const menu = page.getByTestId('menu-toggle');
    const connect = page.getByTestId('connect-open');
    await expect(menu).toBeVisible();
    await expect(connect).toBeVisible();
    await expect(connect).toHaveClass(/connect-launch/);
    const placed = await page.evaluate(() => {
      const connectNode = document.querySelector('[data-testid="connect-open"]');
      const menuNode = document.querySelector('[data-testid="menu-toggle"]');
      if (!(connectNode instanceof HTMLElement) || !(menuNode instanceof HTMLElement)) return null;
      const connectBox = connectNode.getBoundingClientRect();
      const menuBox = menuNode.getBoundingClientRect();
      const radius = (node: HTMLElement) => getComputedStyle(node).borderTopLeftRadius;
      return {
        connectRight: connectBox.right,
        menuLeft: menuBox.x,
        connectRadius: radius(connectNode),
        menuRadius: radius(menuNode),
        connectHeight: connectBox.height,
        menuHeight: menuBox.height,
      };
    });
    expect(placed).not.toBeNull();
    if (!placed) continue;
    expect(placed.connectRight).toBeLessThanOrEqual(placed.menuLeft + 1);
    expect(placed.connectRadius).toBe(placed.menuRadius);
    expect(placed.connectHeight).toBeGreaterThan(40);
    expect(Math.abs(placed.connectHeight - placed.menuHeight)).toBeLessThan(1);
    const board = await page.locator('.board').boundingBox();
    expect(board).not.toBeNull();
    if (!board) continue;
    expect(board.height).toBeGreaterThan(200);
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByTestId('menu-toggle').click();
  const version = page.getByTestId('app-version');
  await expect(version).toBeVisible();
  await expect(version).toHaveText(/^v2\.3\.4$/);
  const size = await version.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
  await expect(page.getByTestId('fanfare-toggle')).toBeVisible();
});

test('reduced motion does not pulse the serve balls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.reload();
  await page.getByTestId('serve-cue').waitFor();
  const cue = await page.getByTestId('serve-a').evaluate((node) => {
    const style = getComputedStyle(node);
    return { name: style.animationName, shadow: style.boxShadow, transform: style.transform };
  });
  expect(cue.name).toBe('none');
  expect(cue.shadow).not.toBe('none');
  expect(cue.transform).toBe('none');
});

const largeWindows = [
  { width: 960, height: 540 },
  { width: 960, height: 600 },
  { width: 1000, height: 560 },
  { width: 1080, height: 540 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
];

test('the serve ball accepts a click on a large window', async ({ page }) => {
  test.setTimeout(60_000);
  for (const size of largeWindows) {
    await page.setViewportSize(size);
    for (const side of ['a', 'b'] as const) {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.reload();
      await page.getByTestId('serve-cue').waitFor();
      await page.getByTestId(`serve-${side}`).click();
      await expect(page.getByTestId(`serve-player-${side}`)).toHaveText('1');
    }
  }
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
  await expect(tiebreak).toContainText('Team A player 1 serves 1 point, from the right');
  await expect(tiebreak).toContainText('Then each player serves 2 points in a row, starting from the left');
  await expect(tiebreak).toContainText('Teams switch sides every 6 points');
  await expect(tiebreak).not.toContainText('then from the right');
  await expect(tiebreak).not.toContainText('player 2');
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
