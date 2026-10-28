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
 * #ffffff on #071006 = 19.34 and on #120e06 = 19.25 (score and plus/minus)
 * #e4ff47 on #071006 = 17.22, #ffb020 on #120e06 = 10.52, #d5d5d5 on #071006 = 13.18
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
    expect(css).toMatch(/\.app \{[^}]*background:\s*#000000;/);
    expect(css).toContain(ONLINE_COURT);
    expect(css).toContain(OFFLINE_COURT);
    expect(css).toContain('.app.is-online');
    expect(css).toContain('.app.is-offline');
    expect(css).toContain('transition: background-color 0.45s ease');
    expect(css).toContain('.offline-label');
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
      ['#ffffff', '#071006'],
      ['#ffffff', '#120e06'],
      ['#e4ff47', '#071006'],
      ['#ffb020', '#120e06'],
      ['#d5d5d5', '#071006'],
      ['#d5d5d5', '#120e06'],
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
