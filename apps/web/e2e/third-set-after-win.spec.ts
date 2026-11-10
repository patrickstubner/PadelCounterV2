import { expect, test, type Page } from '@playwright/test';

/** The settled digit of a set cell. The flip animation keeps the old digit in the DOM for a moment. */
const digit = (page: Page, id: string) => page.locator(`[data-testid="${id}"] .flap-current`);

test('a 2–0 win still lets the third set be scored with plus and minus', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/PadelCounterV2/');
  await page.getByTestId('serve-cue').waitFor();
  for (let i = 0; i < 12; i += 1) await page.getByTestId('increment-a').click();
  await expect(digit(page, 'set-a-1')).toHaveText('6');
  await expect(digit(page, 'set-a-2')).toHaveText('6');
  await expect(page.getByTestId('increment-a')).toBeDisabled();
  await expect(page.getByTestId('increment-b')).toBeDisabled();
  const victory = page.getByTestId('victory');
  if (await victory.isVisible()) await victory.click();
  await expect(victory).toBeHidden();

  // Regression guard: 2.3.1 kept both plus buttons disabled on set 3 after 2–0.
  await page.getByTestId('set-b-3').click();
  await expect(page.getByTestId('increment-a')).toBeEnabled();
  await expect(page.getByTestId('increment-b')).toBeEnabled();
  await page.getByTestId('increment-b').click();
  await page.getByTestId('increment-b').click();
  await expect(digit(page, 'set-b-3')).toHaveText('2');
  await page.getByTestId('decrement-b').click();
  await expect(digit(page, 'set-b-3')).toHaveText('1');
  await expect(digit(page, 'set-a-2')).toHaveText('6');
  await expect(page.locator('.chip-a')).toContainText('Win');
  await expect(page.locator('.chip-b')).toHaveCount(0);
});
