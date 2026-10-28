import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCAL_COURT, OFFLINE_COURT, ONLINE_COURT } from './live/protocol';

/**
 * WCAG 2.x contrast for normal text is 4.5:1. Measured with the relative-luminance formula:
 * #ffffff on #000000 = 21.00, on #163056 = 13.20, on #3a1016 = 16.59
 * #f4f4f4 on #163056 = 12.00, on #3a1016 = 15.09
 * #f2f2f2 on #163056 = 11.79, on #3a1016 = 14.82
 * #d0d0d0 on #163056 = 8.56, on #3a1016 = 10.76, on #141414 = 11.94
 * #a3a3a3 on #000000 = 8.33, on #163056 = 5.23, on #3a1016 = 6.58
 * #e4ff47 on #163056 = 11.75, #ffb020 on #163056 = 7.22
 * #d5d5d5 on #000000 = 14.31, on #163056 = 8.99, on #3a1016 = 11.31
 * #6b6b6b on #163056 = 2.48 and on #3a1016 = 3.11, so those courts do not use it.
 */

function channel(hex: string, index: number): number {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

function linear(channel8: number): number {
  const value = channel8 / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('court background contrast', () => {
  const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');

  it('keeps black, dark blue, and dark red distinct and eases between them', () => {
    expect(LOCAL_COURT).toBe('#000000');
    expect(ONLINE_COURT).toBe('#163056');
    expect(OFFLINE_COURT).toBe('#3a1016');
    expect(new Set([LOCAL_COURT, ONLINE_COURT, OFFLINE_COURT]).size).toBe(3);
    expect(channel(ONLINE_COURT, 2)).toBeGreaterThan(channel(ONLINE_COURT, 0) + 40);
    expect(channel(OFFLINE_COURT, 0)).toBeGreaterThan(channel(OFFLINE_COURT, 2) + 20);
    expect(css).toContain(`--court: ${LOCAL_COURT}`);
    expect(css).toContain(`--court-online: ${ONLINE_COURT}`);
    expect(css).toContain(`--court-offline: ${OFFLINE_COURT}`);
    expect(css).toContain('.app.is-online { --court: var(--court-online); }');
    expect(css).toContain('.app.is-offline { --court: var(--court-offline); }');
    expect(css).toContain('transition: background-color 0.45s ease');
    expect(css).toContain('.offline-label');
    expect(css).not.toContain('--a-bg');
    expect(css).not.toContain('--b-bg');
  });

  it('paints both court halves with the same colour in every state', () => {
    const teamRule = css.slice(css.indexOf('.team-a,'), css.indexOf('.team-a { --accent'));
    expect(teamRule).toContain('background: var(--court)');
    expect(teamRule).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    const halves = ['.team-a', '.team-b', '.top', '.foot', '.mid', '.app'];
    for (const selector of halves) {
      expect(css, selector).toContain('var(--court)');
    }
    const oldHalves = ['#071006', '#120e06'];
    const darkerOld = oldHalves.reduce((darker, hex) => (luminance(hex) < luminance(darker) ? hex : darker));
    expect(darkerOld).toBe('#071006');
    expect(luminance(LOCAL_COURT)).toBeLessThan(luminance(darkerOld));
  });

  it('keeps court text, scores, and buttons at WCAG AA', () => {
    const pairs = [
      ['#ffffff', LOCAL_COURT],
      ['#a3a3a3', LOCAL_COURT],
      ['#ffffff', ONLINE_COURT],
      ['#f4f4f4', ONLINE_COURT],
      ['#f2f2f2', ONLINE_COURT],
      ['#d0d0d0', ONLINE_COURT],
      ['#a3a3a3', ONLINE_COURT],
      ['#ffffff', OFFLINE_COURT],
      ['#f4f4f4', OFFLINE_COURT],
      ['#f2f2f2', OFFLINE_COURT],
      ['#d0d0d0', OFFLINE_COURT],
      ['#a3a3a3', OFFLINE_COURT],
      ['#d5d5d5', LOCAL_COURT],
      ['#d5d5d5', ONLINE_COURT],
      ['#d5d5d5', OFFLINE_COURT],
      ['#e4ff47', LOCAL_COURT],
      ['#e4ff47', ONLINE_COURT],
      ['#e4ff47', OFFLINE_COURT],
      ['#ffb020', LOCAL_COURT],
      ['#ffb020', ONLINE_COURT],
      ['#ffb020', OFFLINE_COURT],
      ['#d0d0d0', '#141414'],
    ] as const;
    for (const [foreground, background] of pairs) {
      expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#6b6b6b', ONLINE_COURT)).toBeLessThan(4.5);
    expect(contrast('#6b6b6b', OFFLINE_COURT)).toBeLessThan(4.5);
    expect(contrast('#6b6b6b', '#141414')).toBeLessThan(4.5);
    expect(css).toMatch(/\.app\.is-online[\s\S]*\.app\.is-offline \.undo-btn:disabled \{\s*color:\s*#d0d0d0;/);
  });
});
