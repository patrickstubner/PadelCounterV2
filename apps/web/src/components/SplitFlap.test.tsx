import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flapMotion } from './SplitFlap';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app.css'), 'utf8');

function keyframe(name: string): string {
  const start = css.indexOf(`@keyframes ${name} {`);
  expect(start, name).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('split flap direction', () => {
  it('sends a higher score up and a lower score down', () => {
    expect(flapMotion('4', '5')).toBe('up');
    expect(flapMotion('5', '6')).toBe('up');
    expect(flapMotion('6', '7')).toBe('up');
    expect(flapMotion('9', '10')).toBe('up');
    expect(flapMotion('6', '5')).toBe('down');
    expect(flapMotion('7', '6')).toBe('down');
    expect(flapMotion('10', '9')).toBe('down');
    expect(flapMotion('–', '0')).toBe('up');
  });

  it('maps plus upward and minus downward in the keyframes', () => {
    const leaveUp = keyframe('drive-out');
    const enterUp = keyframe('drive-in');
    const leaveDown = keyframe('drive-out-down');
    const enterDown = keyframe('drive-in-down');
    expect(leaveUp).toContain('translateY(-110%)');
    expect(enterUp).toContain('translateY(110%)');
    expect(leaveDown).toContain('translateY(110%)');
    expect(enterDown).toContain('translateY(-110%)');
    expect(css).toContain('.flap.is-down .flap-leave { animation-name: drive-out-down; }');
    expect(css).toContain('.flap.is-down .flap-enter { animation-name: drive-in-down; }');
  });

  it('sizes the portrait digit to the free column only when text-box-trim exists', () => {
    const portrait = css.slice(css.indexOf('@media (orientation: portrait)'), css.indexOf('.victory {'));
    const fallback = portrait.slice(portrait.indexOf('.current-set .num {'), portrait.indexOf('@supports (text-box-trim: trim-both)'));
    expect(fallback).toContain('overflow: visible');
    expect(fallback).toContain('letter-spacing: 0');
    expect(fallback).toContain('clamp(3rem, min(96cqh, calc(100cqw / 1.22)), 18rem)');
    expect(fallback).not.toContain('text-box-trim');
    expect(fallback).not.toContain('100cqh / 0.8');
    const supported = portrait.slice(portrait.indexOf('@supports (text-box-trim: trim-both)'), portrait.indexOf('.current-set.is-won'));
    expect(supported).toContain('text-box-trim: trim-both');
    expect(supported).toContain('100cqh / 0.8');
    expect(supported).toContain('100cqw / 0.66');
    expect(portrait).not.toContain('data-chars');
    expect(portrait).not.toContain('including 10');
    expect(css).toContain('font-variant-numeric: tabular-nums');
  });

  it('keeps landscape set digits inside the cell, including 0, 6, and 10', () => {
    const rule = css.slice(css.indexOf('.num,\n.flap {'), css.indexOf('.set.is-won'));
    expect(rule).toContain('letter-spacing: 0');
    expect(rule).not.toContain('letter-spacing: -0.055em');
    expect(rule).toContain('100cqw / 1.35');
    expect(rule).toContain('92cqh');
    const flap = css.slice(css.indexOf('.set .flap {'), css.indexOf('.set.is-won'));
    expect(flap).toContain('overflow: visible');
    const plus = css.slice(css.indexOf('.step-plus,'), css.indexOf('.step:disabled'));
    expect(plus).toContain('background: transparent');
    expect(plus).toContain('box-shadow: inset 0 0 0 3px var(--accent)');
    expect(plus).not.toContain('background: var(--accent)');
  });
});
