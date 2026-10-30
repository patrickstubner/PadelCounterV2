import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HAPTIC_KEY,
  HAPTIC_MS,
  bindCourtTaps,
  hapticEnabled,
  pulseHaptic,
  setHapticEnabled,
  type CourtTapTarget,
  type HapticEnv,
} from './haptic';

const root = dirname(fileURLToPath(import.meta.url));

function storage() {
  const stored = new Map<string, string>();
  return {
    stored,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
  };
}

function env(partial: Partial<HapticEnv> = {}): { env: HapticEnv; vibrate: number[]; clicks: number } {
  const vibrate: number[] = [];
  const clicks = { n: 0 };
  return {
    vibrate,
    clicks: clicks.n,
    env: {
      vibrate: partial.vibrate === undefined ? (ms: number) => { vibrate.push(ms); } : partial.vibrate,
      clickSwitch: partial.clickSwitch === undefined ? () => { clicks.n += 1; } : partial.clickSwitch,
      switchSupported: partial.switchSupported ?? false,
    },
  };
}

describe('haptic preference', () => {
  it('is on unless this device stored off', () => {
    const store = storage();
    expect(hapticEnabled(store)).toBe(true);
    setHapticEnabled(store, false);
    expect(store.stored.get(HAPTIC_KEY)).toBe('off');
    expect(hapticEnabled(store)).toBe(false);
    setHapticEnabled(store, true);
    expect(store.stored.get(HAPTIC_KEY)).toBe('on');
    expect(hapticEnabled(store)).toBe(true);
  });
});

describe('pulseHaptic', () => {
  it('vibrates once for 10–15 ms and does not click the switch', () => {
    expect(HAPTIC_MS).toBeGreaterThanOrEqual(10);
    expect(HAPTIC_MS).toBeLessThanOrEqual(15);
    const seen = env();
    pulseHaptic(true, seen.env);
    expect(seen.vibrate).toEqual([HAPTIC_MS]);
    expect(seen.env.clickSwitch).toBeTypeOf('function');
    const clicks = { n: 0 };
    pulseHaptic(true, {
      vibrate: (ms) => { seen.vibrate.push(ms); },
      clickSwitch: () => { clicks.n += 1; },
      switchSupported: true,
    });
    expect(clicks.n).toBe(0);
    expect(seen.vibrate).toEqual([HAPTIC_MS, HAPTIC_MS]);
  });

  it('does not vibrate or click when the setting is off', () => {
    const clicks = { n: 0 };
    const vibrate: number[] = [];
    pulseHaptic(false, {
      vibrate: (ms) => { vibrate.push(ms); },
      clickSwitch: () => { clicks.n += 1; },
      switchSupported: true,
    });
    expect(vibrate).toEqual([]);
    expect(clicks.n).toBe(0);
  });

  it('clicks the iOS switch when vibrate is missing', () => {
    const clicks = { n: 0 };
    pulseHaptic(true, {
      vibrate: null,
      clickSwitch: () => { clicks.n += 1; },
      switchSupported: true,
    });
    expect(clicks.n).toBe(1);
  });

  it('stays quiet when vibrate and the switch are both missing', () => {
    const clicks = { n: 0 };
    expect(() => pulseHaptic(true, {
      vibrate: null,
      clickSwitch: () => { clicks.n += 1; },
      switchSupported: false,
    })).not.toThrow();
    expect(clicks.n).toBe(0);
  });

  it('swallows a vibrate throw and does not fall through to the switch', () => {
    const clicks = { n: 0 };
    expect(() => pulseHaptic(true, {
      vibrate: () => { throw new Error('blocked'); },
      clickSwitch: () => { clicks.n += 1; },
      switchSupported: true,
    })).not.toThrow();
    expect(clicks.n).toBe(0);
  });

  it('swallows a switch click that throws', () => {
    expect(() => pulseHaptic(true, {
      vibrate: null,
      clickSwitch: () => { throw new Error('missing'); },
      switchSupported: true,
    })).not.toThrow();
  });

  it('keeps the duration in this file and does not call a remote host', () => {
    const source = readFileSync(join(root, 'haptic.ts'), 'utf8');
    expect(source).toContain('HAPTIC_MS = 15');
    expect(source).toContain(HAPTIC_KEY);
    expect(source).not.toContain('http://');
    expect(source).not.toContain('https://');
    expect(source).not.toContain('innerHTML');
  });
});

describe('court taps', () => {
  function target(): { calls: string[]; api: CourtTapTarget } {
    const calls: string[] = [];
    return {
      calls,
      api: {
        increment: () => { calls.push('increment'); },
        decrement: () => { calls.push('decrement'); },
        chooseServe: () => { calls.push('serve'); },
        selectSet: () => { calls.push('set'); },
      },
    };
  }

  it('ticks after plus, minus, and the serve ball', () => {
    const court = target();
    const ticks: string[] = [];
    const taps = bindCourtTaps(0, court.api, () => { ticks.push('tick'); });
    taps.onIncrement('a');
    taps.onDecrement('b');
    taps.onServe('a');
    expect(court.calls).toEqual(['increment', 'decrement', 'serve']);
    expect(ticks).toEqual(['tick', 'tick', 'tick']);
  });

  it('ticks only when the set actually changes', () => {
    const court = target();
    const ticks: string[] = [];
    const taps = bindCourtTaps(0, court.api, () => { ticks.push('tick'); });
    taps.onSelectSet(0);
    taps.onSelectSet(1);
    expect(court.calls).toEqual(['set', 'set']);
    expect(ticks).toEqual(['tick']);
  });
});
