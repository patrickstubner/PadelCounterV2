import { describe, expect, it } from 'vitest';
import { acceptsLiveBaseName } from './names';
import {
  CODE_FAILS_GLOBAL,
  CODE_FAILS_PER_IP,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  JOIN_CODE_SPACE,
  joinCodeCompact,
  normalizeJoinCode,
  randomJoinCode,
} from './joinCode';

describe('short match codes', () => {
  it('uses 32 unambiguous symbols and 30 bits', () => {
    expect(JOIN_CODE_ALPHABET).toHaveLength(31);
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect(JOIN_CODE_SPACE).toBe(31 ** JOIN_CODE_LENGTH);
    expect(JOIN_CODE_SPACE).toBe(887_503_681);
    const minutes = 120;
    expect(CODE_FAILS_PER_IP * minutes).toBe(1_200);
    expect(CODE_FAILS_GLOBAL * minutes).toBe(7_200);
    expect(CODE_FAILS_GLOBAL * minutes).toBeLessThan(JOIN_CODE_SPACE / 100_000);
  });

  it('accepts case and a hyphen, and refuses lookalikes', () => {
    expect(normalizeJoinCode('k7m-42q')).toBe('K7M-42Q');
    expect(normalizeJoinCode('k7m42q')).toBe('K7M-42Q');
    expect(normalizeJoinCode('  K7M 42Q ')).toBe('K7M-42Q');
    expect(joinCodeCompact('K7M-42Q')).toBe('K7M42Q');
    expect(normalizeJoinCode('K7M-42O')).toBeNull();
    expect(normalizeJoinCode('K7M-420')).toBeNull();
    expect(normalizeJoinCode('K7M-42I')).toBeNull();
    expect(normalizeJoinCode('K7M-421')).toBeNull();
    expect(normalizeJoinCode('K7M-42L')).toBeNull();
    expect(normalizeJoinCode('short')).toBeNull();
    expect(normalizeJoinCode('K7M-42Q-EXTRA')).toBeNull();
  });

  it('skips bytes that would bias the alphabet', () => {
    const values = [255, 248, 0, 30, 31, 1, 2];
    const code = randomJoinCode(() => values.shift() ?? 0);
    expect(code).toBe('A9A-BCA');
    expect(normalizeJoinCode(code)).toBe(code);
    for (let n = 0; n < 40; n += 1) {
      const next = randomJoinCode();
      expect(normalizeJoinCode(next)).toBe(next);
    }
  });
});

describe('live base names', () => {
  it('accepts a normal name and refuses a stack of marks', () => {
    expect(acceptsLiveBaseName('भारतीय टीम')).toBe(true);
    expect(acceptsLiveBaseName('Team A')).toBe(true);
    expect(acceptsLiveBaseName(`5${'\u0301'.repeat(4)}`)).toBe(true);
    expect(acceptsLiveBaseName(`5${'\u0301'.repeat(8)}`)).toBe(false);
    expect(acceptsLiveBaseName('A\u00A0B')).toBe(false);
  });
});
