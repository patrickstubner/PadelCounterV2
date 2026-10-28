import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_TEAM_NAME_LENGTH,
  UNSAFE_CHARS,
  codePointLength,
  isValidStoredName,
  sanitizeTeamName,
} from './names';
import type { TeamId } from './types';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('unsafe character filter', () => {
  it('uses the Unicode control and format class in both checks', () => {
    expect(UNSAFE_CHARS.source).toContain('\\p{Cc}');
    expect(UNSAFE_CHARS.source).toContain('\\p{Cf}');
    expect(UNSAFE_CHARS.flags).toBe('gu');
    const samples = ['\u0000', '\u001F', '\u007F', '\u0085', '\u009F', '\u00AD', '\u200B', '\u202E', '\u2028', '\u2029', '\uFEFF'];
    for (const sample of samples) {
      expect(sanitizeTeamName(`A${sample}B`, 'a')).toBe('AB');
      expect(isValidStoredName(`A${sample}B`)).toBe(false);
      expect(isValidStoredName(`A${sample}B`)).toBe(false);
    }
    expect(isValidStoredName('Team A')).toBe(true);
    expect(isValidStoredName('äöü')).toBe(true);
  });
});

describe('sanitizeTeamName', () => {
  it('limits length by code point and strips controls and bidi marks', () => {
    expect(sanitizeTeamName(`\u202E${'A'.repeat(30)}`, 'a')).toBe('A'.repeat(MAX_TEAM_NAME_LENGTH));
    expect(sanitizeTeamName('Zeile\u0000\nZwei', 'b')).toBe('ZeileZwei');
    expect(sanitizeTeamName('   ', 'a')).toBe('Team A');
    expect(sanitizeTeamName('äöü', 'b')).toBe('äöü');
    const emojis = '🎾'.repeat(25);
    expect(codePointLength(sanitizeTeamName(emojis, 'a'))).toBe(MAX_TEAM_NAME_LENGTH);
    expect(sanitizeTeamName(emojis, 'a')).not.toMatch(LONE_SURROGATE);
  });

  it('trims again after the code-point cut and drops a lone surrogate', () => {
    expect(sanitizeTeamName(`${'A'.repeat(23)} B`, 'a')).toBe('A'.repeat(23));
    expect(sanitizeTeamName(`${'A'.repeat(23)}\uD800B`, 'b')).toBe('A'.repeat(23));
    expect(sanitizeTeamName(`${'A'.repeat(22)} \uD800`, 'a')).toBe('A'.repeat(22));
    expect(sanitizeTeamName('\uD800', 'a')).toBe('Team A');
    expect(sanitizeTeamName('🎾', 'b')).toBe('🎾');
  });

  it('rejects tampered stored names instead of repairing them', () => {
    expect(isValidStoredName('Team A')).toBe(true);
    expect(isValidStoredName('A'.repeat(MAX_TEAM_NAME_LENGTH))).toBe(true);
    expect(isValidStoredName('A'.repeat(MAX_TEAM_NAME_LENGTH + 1))).toBe(false);
    expect(isValidStoredName('\u3164')).toBe(false);
    expect(isValidStoredName('\u2800')).toBe(false);
    expect(isValidStoredName(' Bad')).toBe(false);
    expect(isValidStoredName('A\u200B')).toBe(false);
    expect(isValidStoredName('A\uD800')).toBe(false);
    expect(isValidStoredName('🎾'.repeat(MAX_TEAM_NAME_LENGTH))).toBe(true);
    expect(isValidStoredName('🎾'.repeat(MAX_TEAM_NAME_LENGTH + 1))).toBe(false);
  });

  it('always stores a name that passes the load check', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), fc.constantFrom<TeamId>('a', 'b'), (input, team) => {
        const name = sanitizeTeamName(input, team);
        expect(isValidStoredName(name)).toBe(true);
        expect(codePointLength(name)).toBeLessThanOrEqual(MAX_TEAM_NAME_LENGTH);
        expect(name).toBe(name.normalize('NFC'));
        expect(name).toBe(name.trim());
        expect(name).not.toMatch(LONE_SURROGATE);
        UNSAFE_CHARS.lastIndex = 0;
        expect(UNSAFE_CHARS.test(name)).toBe(false);
        expect(sanitizeTeamName(name, team)).toBe(name);
      }),
      { numRuns: 200 },
    );
  });
});
