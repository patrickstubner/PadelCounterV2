import { expect, test, type Page } from '@playwright/test';

async function openCourt(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/PadelCounterV2/');
  await page.getByTestId('serve-cue').waitFor();
}

function glowReach(shadow: string): number {
  const layers = shadow.split(/,(?![^(]*\))/);
  let max = 0;
  for (const layer of layers) {
    const nums = [...layer.matchAll(/([\d.]+)px/g)].map((match) => Number(match[1]));
    if (nums.length < 2) continue;
    max = Math.max(max, (nums.at(-1) ?? 0) + (nums.at(-2) ?? 0));
  }
  return max;
}

async function ballStyle(page: Page, id: string): Promise<{ name: string; shadow: string; transform: string; width: number; height: number }> {
  return page.getByTestId(id).evaluate((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return {
      name: style.animationName,
      shadow: style.boxShadow,
      transform: style.transform,
      width: box.width,
      height: box.height,
    };
  });
}

test('both balls glow until a serving team is chosen, without moving', async ({ page }) => {
  await openCourt(page);
  await expect(page.getByTestId('serve-a')).toHaveClass(/is-cue/);
  await expect(page.getByTestId('serve-b')).toHaveClass(/is-cue/);
  const before = await ballStyle(page, 'serve-a');
  expect(before.name).toBe('serve-glow');
  expect(before.shadow).not.toBe('none');
  expect(before.transform).toBe('none');
  expect(before.width).toBeGreaterThan(48);
  expect(before.height).toBe(before.width);
  await page.waitForTimeout(700);
  const after = await ballStyle(page, 'serve-a');
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  expect(after.transform).toBe('none');
  await page.getByTestId('serve-a').click();
  await expect(page.getByTestId('serve-a')).not.toHaveClass(/is-cue/);
  await expect(page.getByTestId('serve-b')).not.toHaveClass(/is-cue/);
  await expect(page.getByTestId('serve-a')).not.toHaveClass(/is-ask/);
  const chosen = await ballStyle(page, 'serve-a');
  expect(chosen.name).toBe('none');
});

test('only the team that must pick a player gets the stronger glow', async ({ page }) => {
  await openCourt(page);
  await page.getByTestId('serve-a').click();
  for (let game = 0; game < 6; game += 1) {
    await page.getByTestId('increment-a').click();
    await page.getByTestId('increment-b').click();
  }
  await page.getByTestId('increment-b').click();
  await expect(page.getByTestId('next-set-hint')).toBeVisible();
  await expect(page.getByTestId('serve-b')).toHaveClass(/is-ask/);
  await expect(page.getByTestId('serve-a')).not.toHaveClass(/is-cue|is-ask/);
  const asked = await ballStyle(page, 'serve-b');
  const other = await ballStyle(page, 'serve-a');
  expect(asked.name).toBe('serve-glow-strong');
  expect(asked.shadow).not.toBe('none');
  expect(asked.transform).toBe('none');
  expect(other.name).toBe('none');
  expect(other.shadow).toBe('none');
  const before = await ballStyle(page, 'serve-b');
  await page.waitForTimeout(700);
  const after = await ballStyle(page, 'serve-b');
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  await page.getByTestId('serve-b').click();
  await expect(page.getByTestId('serve-player-b')).toHaveText('1');
  await expect(page.getByTestId('serve-b')).not.toHaveClass(/is-ask/);
  await expect(page.getByTestId('serve-a')).not.toHaveClass(/is-ask/);
  const quiet = await ballStyle(page, 'serve-b');
  expect(quiet.name).toBe('none');
});

test('reduced motion keeps a still glow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCourt(page);
  const cue = await ballStyle(page, 'serve-a');
  expect(cue.name).toBe('none');
  expect(cue.shadow).not.toBe('none');
  expect(cue.transform).toBe('none');
  const stillRing = await page.getByTestId('serve-a').evaluate((node) => {
    const ring = getComputedStyle(node, '::after');
    return { content: ring.content, name: ring.animationName, offset: ring.outlineOffset };
  });
  expect(stillRing.content).toBe('none');
  expect(stillRing.name).toBe('none');
  expect(stillRing.offset).toBe('0px');
  await page.getByTestId('serve-a').click();
  for (let game = 0; game < 6; game += 1) {
    await page.getByTestId('increment-a').click();
    await page.getByTestId('increment-b').click();
  }
  await page.getByTestId('increment-b').click();
  const asked = await ballStyle(page, 'serve-b');
  const other = await ballStyle(page, 'serve-a');
  expect(asked.name).toBe('none');
  expect(asked.shadow).not.toBe('none');
  expect(glowReach(asked.shadow)).toBeGreaterThan(glowReach(cue.shadow));
  expect(other.shadow).toBe('none');
  await page.getByTestId('serve-b').click();
  expect((await ballStyle(page, 'serve-b')).name).toBe('none');
  expect((await ballStyle(page, 'serve-b')).shadow).toBe('none');
});

test('the ring shrinks slightly, then grows, with the glow', async ({ page }) => {
  await openCourt(page);
  const timing = await page.getByTestId('serve-a').evaluate((node) => {
    const ball = getComputedStyle(node);
    const ring = getComputedStyle(node, '::after');
    const frames = (name: string) => {
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (rule instanceof CSSKeyframesRule && rule.name === name) {
            return [...rule.cssRules].map((item) => (item as CSSKeyframeRule).keyText);
          }
        }
      }
      return [];
    };
    return {
      ballName: ball.animationName,
      ballDuration: ball.animationDuration,
      ballTiming: ball.animationTimingFunction,
      ballIteration: ball.animationIterationCount,
      ballTransform: ball.transform,
      ringName: ring.animationName,
      ringDuration: ring.animationDuration,
      ringTiming: ring.animationTimingFunction,
      ringIteration: ring.animationIterationCount,
      glowFrames: frames('serve-glow'),
      strongFrames: frames('serve-glow-strong'),
      ringFrames: frames('serve-ring'),
    };
  });
  expect(timing.ballName).toBe('serve-glow');
  expect(timing.ringName).toBe('serve-ring');
  expect(timing.ringDuration).toBe(timing.ballDuration);
  expect(timing.ringTiming).toBe(timing.ballTiming);
  expect(timing.ringIteration).toBe('infinite');
  expect(timing.ballIteration).toBe('infinite');
  expect(timing.ballTransform).toBe('none');
  expect(timing.glowFrames).toEqual(timing.ringFrames);
  expect(timing.strongFrames).toEqual(timing.ringFrames);
  expect(timing.ringFrames).toEqual(['0%, 100%', '20%', '50%']);

  const sample = (fraction: number) => page.getByTestId('serve-a').evaluate((node, at) => {
    const animations = document.getAnimations().flatMap((item) => {
      const effect = item.effect;
      if (!(effect instanceof KeyframeEffect) || effect.target !== node) return [];
      const duration = Number(effect.getComputedTiming().duration);
      item.pause();
      item.currentTime = duration * at;
      return [{ name: item.animationName, pseudo: effect.pseudoElement, duration }];
    });
    const ball = getComputedStyle(node);
    const ring = getComputedStyle(node, '::after');
    const layers = ball.boxShadow.split(/,(?![^(]*\))/);
    let reach = 0;
    for (const layer of layers) {
      const nums = [...layer.matchAll(/([\d.]+)px/g)].map((match) => Number(match[1]));
      if (nums.length >= 2) reach = Math.max(reach, (nums.at(-1) ?? 0) + (nums.at(-2) ?? 0));
    }
    return {
      animations,
      reach,
      offset: Number.parseFloat(ring.outlineOffset),
      transform: ball.transform,
    };
  }, fraction);

  const shrunk = await sample(0.2);
  const grown = await sample(0.5);
  expect(shrunk.animations.map((item) => `${item.pseudo ?? ''}:${item.name}`).sort()).toEqual(['::after:serve-ring', ':serve-glow']);
  expect(grown.animations.map((item) => `${item.pseudo ?? ''}:${item.name}`).sort()).toEqual(['::after:serve-ring', ':serve-glow']);
  expect(shrunk.transform).toBe('none');
  expect(grown.transform).toBe('none');
  expect(shrunk.offset).toBeLessThan(0);
  expect(grown.offset).toBeGreaterThan(0);
  expect(grown.reach).toBeGreaterThan(shrunk.reach);

  const box = await page.getByTestId('serve-a').boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.getByTestId('serve-a').click();
  await expect(page.getByTestId('serve-player-a')).toHaveText('1');
});

test('the spotlight is not clipped by the court', async ({ page }) => {
  await openCourt(page);
  for (const size of [
    { width: 390, height: 780 },
    { width: 844, height: 390 },
    { width: 960, height: 540 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    const clippers = await page.evaluate(() => {
      const hits: string[] = [];
      for (const id of ['serve-a', 'serve-b']) {
        const ball = document.querySelector(`[data-testid="${id}"]`);
        if (!(ball instanceof HTMLElement)) {
          hits.push(`${id} missing`);
          continue;
        }
        const box = ball.getBoundingClientRect();
        const reach = Number.parseFloat(getComputedStyle(ball).getPropertyValue('--glow-reach'));
        const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        const pad = reach * root;
        const glow = {
          top: box.top - pad,
          right: box.right + pad,
          bottom: box.bottom + pad,
          left: box.left - pad,
        };
        let node = ball.parentElement;
        while (node) {
          const style = getComputedStyle(node);
          const screen = node.tagName === 'BODY' || node.tagName === 'HTML';
          if (!screen && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) {
            const edge = node.getBoundingClientRect();
            if (
              glow.top < edge.top - 1
              || glow.right > edge.right + 1
              || glow.bottom > edge.bottom + 1
              || glow.left < edge.left - 1
            ) {
              hits.push(`${id} ${node.className || node.tagName}`);
            }
          }
          node = node.parentElement;
        }
      }
      return hits;
    });
    expect(clippers, `${size.width}x${size.height}`).toEqual([]);
  }
});
