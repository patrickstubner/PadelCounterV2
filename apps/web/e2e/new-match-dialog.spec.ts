import { expect, test } from '@playwright/test';

test('new match shows a large names box and only two buttons on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/PadelCounterV2/');
  await page.getByTestId('serve-cue').waitFor();
  await page.locator('.team-a .team-name').click();
  await page.getByLabel('Team name').fill('Anna & Ben');
  await page.getByLabel('Team name').press('Enter');
  await page.getByTestId('increment-a').click();
  await page.getByTestId('menu-toggle').click();
  await page.getByTestId('new-match').click();

  const dialog = page.locator('dialog[aria-labelledby="new-match-title"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveCount(2);
  const names = page.getByTestId('carry-names');
  await expect(names).toBeChecked();
  await expect(dialog).toContainText('Keep team names (Anna & Ben · Team B)');
  const boxSize = await names.boundingBox();
  expect(boxSize?.width ?? 0).toBeGreaterThanOrEqual(24);
  const namesRow = page.locator('.dialog-check').filter({ has: names });
  const row = await namesRow.boundingBox();
  expect(row?.height ?? 0).toBeGreaterThanOrEqual(44);
  const frame = await dialog.boundingBox();
  expect((frame?.y ?? 0) + (frame?.height ?? 0)).toBeLessThanOrEqual(640);
  await page.screenshot({ path: 'test-results/new-match-dialog.png' });
  await namesRow.click();
  await expect(names).not.toBeChecked();
  await page.getByTestId('cancel-new-match').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.team-a .team-name')).toHaveText('Anna & Ben');
});
