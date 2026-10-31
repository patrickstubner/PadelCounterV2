import { expect, test, type Page } from '@playwright/test';

const portraits = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 440, height: 956 },
];

const glyphs = ['0', '6', '8', '9'] as const;

interface DigitFit {
  readonly text: string;
  readonly ratio: number;
  readonly inside: boolean;
  readonly clippers: readonly string[];
  readonly display: string;
}

function readDigit(selector: string): DigitFit | null {
  const container = document.querySelector(selector);
  if (!(container instanceof HTMLElement)) return null;
  const textEl = container.querySelector('.flap-current');
  const flap = container.querySelector('.flap');
  if (!(textEl instanceof HTMLElement) || !(flap instanceof HTMLElement)) return null;
  const style = getComputedStyle(textEl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const text = textEl.firstChild?.textContent ?? textEl.textContent ?? '';
  const metrics = ctx.measureText(text);
  const box = textEl.getBoundingClientRect();
  const fontSize = Number.parseFloat(style.fontSize);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const marker = document.createElement('span');
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  textEl.appendChild(marker);
  const baseline = marker.getBoundingClientRect().top;
  marker.remove();
  const ink = {
    top: baseline - metrics.actualBoundingBoxAscent,
    bottom: baseline + metrics.actualBoundingBoxDescent,
    left: box.left - metrics.actualBoundingBoxLeft,
    right: box.left + metrics.actualBoundingBoxRight,
  };
  const pad = 0.75;
  const clippers: string[] = [];
  let node: HTMLElement | null = flap;
  while (node) {
    const cs = getComputedStyle(node);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const edge = node.getBoundingClientRect();
      if (
        ink.top < edge.top - pad
        || ink.bottom > edge.bottom + pad
        || ink.left < edge.left - pad
        || ink.right > edge.right + pad
      ) {
        clippers.push(node.getAttribute('data-testid') || node.className || node.tagName);
      }
    }
    node = node.parentElement;
  }
  const containerBox = container.getBoundingClientRect();
  return {
    text,
    ratio: lineHeight / fontSize,
    inside: ink.top >= containerBox.top - pad
      && ink.bottom <= containerBox.bottom + pad
      && ink.left >= containerBox.left - pad
      && ink.right <= containerBox.right + pad,
    clippers,
    display: getComputedStyle(container).display,
  };
}

async function showGlyph(page: Page, glyph: string): Promise<void> {
  await page.evaluate((next) => {
    for (const id of ['current-a', 'current-b']) {
      const node = document.querySelector(`[data-testid="${id}"] .flap-current`);
      if (node) node.textContent = next;
    }
  }, glyph);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/PadelCounterV2/');
  await page.getByTestId('serve-cue').waitFor();
});

test('portrait current-set digits are fully inside their column', async ({ page }) => {
  for (const size of portraits) {
    await page.setViewportSize(size);
    for (const glyph of glyphs) {
      await showGlyph(page, glyph);
      for (const id of ['current-a', 'current-b'] as const) {
        const fit = await page.evaluate(readDigit, `[data-testid="${id}"]`);
        expect(fit, `${size.width}x${size.height} ${id} ${glyph}`).not.toBeNull();
        if (!fit) continue;
        expect(fit.display, id).not.toBe('none');
        expect(fit.text, id).toBe(glyph);
        expect(fit.ratio, id).toBeGreaterThanOrEqual(1);
        expect(fit.inside, `${id} ${glyph}`).toBe(true);
        expect(fit.clippers, `${id} ${glyph}`).toEqual([]);
      }
    }
  }
});

test('landscape set digits stay fully inside the cell', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  for (const glyph of glyphs) {
    await page.evaluate((next) => {
      const node = document.querySelector('[data-testid="set-a-1"] .flap-current');
      if (node) node.textContent = next;
    }, glyph);
    const current = await page.evaluate(readDigit, '[data-testid="current-a"]');
    expect(current?.display).toBe('none');
    const fit = await page.evaluate(readDigit, '[data-testid="set-a-1"]');
    expect(fit, glyph).not.toBeNull();
    if (!fit) continue;
    expect(fit.text).toBe(glyph);
    expect(fit.inside, glyph).toBe(true);
    expect(fit.clippers, glyph).toEqual([]);
  }
});
