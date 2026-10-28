import { describe, expect, it } from 'vitest';
import { networkPrefix } from './address';
import { createMatch, prepareLiveLog, replayScore } from './reducer';
import { acceptsLiveBaseName, clampLiveTeamName, parseLiveTeamName } from './names';
import {
  CODE_ALARM_GLOBAL,
  CODE_ATTEMPTS_PER_PREFIX,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  JOIN_CODE_SPACE,
  MAX_MINTED_TOKENS,
  joinCodeCompact,
  normalizeJoinCode,
  randomJoinCode,
} from './joinCode';

describe('short match codes', () => {
  it('uses 31 symbols and eight characters', () => {
    expect(JOIN_CODE_ALPHABET).toHaveLength(31);
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect(JOIN_CODE_LENGTH).toBe(8);
    expect(JOIN_CODE_SPACE).toBe(31 ** 8);
    expect(JOIN_CODE_SPACE).toBe(852_891_037_441);
    const minutes = 120;
    expect(CODE_ATTEMPTS_PER_PREFIX * minutes).toBe(1_200);
    expect(CODE_ATTEMPTS_PER_PREFIX * minutes).toBeLessThan(JOIN_CODE_SPACE / 1_000_000);
    expect(CODE_ALARM_GLOBAL).toBeGreaterThan(CODE_ATTEMPTS_PER_PREFIX * 100);
    expect(MAX_MINTED_TOKENS).toBe(8);
  });

  it('accepts case and a hyphen, and refuses lookalikes', () => {
    expect(normalizeJoinCode('k7m4-2qab')).toBe('K7M4-2QAB');
    expect(normalizeJoinCode('k7m42qab')).toBe('K7M4-2QAB');
    expect(normalizeJoinCode('  K7M4 2QAB ')).toBe('K7M4-2QAB');
    expect(joinCodeCompact('K7M4-2QAB')).toBe('K7M42QAB');
    expect(normalizeJoinCode('K7M-42Q')).toBeNull();
    expect(normalizeJoinCode('K7M4-2QAO')).toBeNull();
    expect(normalizeJoinCode('K7M4-2QA0')).toBeNull();
    expect(normalizeJoinCode('K7M4-2QAI')).toBeNull();
    expect(normalizeJoinCode('K7M4-2QA1')).toBeNull();
    expect(normalizeJoinCode('K7M4-2QAL')).toBeNull();
  });

  it('skips bytes that would bias the alphabet', () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(randomJoinCode(() => values.shift() ?? 0)).toBe('ABCD-EFGH');
    for (let n = 0; n < 20; n += 1) {
      const next = randomJoinCode();
      expect(normalizeJoinCode(next)).toBe(next);
    }
  });
});

describe('network prefix', () => {
  it('keeps an IPv4 address and folds an IPv6 address to /64', () => {
    expect(networkPrefix('203.0.113.5')).toBe('203.0.113.5');
    expect(networkPrefix('2001:db8:1:2::1')).toBe(networkPrefix('2001:db8:1:2::abcd'));
    expect(networkPrefix('2001:db8:1:2::1')).toBe('2001:0db8:0001:0002::/64');
    expect(networkPrefix('2001:db8:9:9::1')).not.toBe(networkPrefix('2001:db8:1:2::1'));
    expect(networkPrefix('::ffff:203.0.113.8')).toBe('203.0.113.8');
  });
});

describe('live names from replay', () => {
  it('accepts a normal name and refuses a stack of marks on the raw check', () => {
    expect(acceptsLiveBaseName('भारतीय टीम')).toBe(true);
    expect(acceptsLiveBaseName(`5${'\u0301'.repeat(8)}`)).toBe(false);
  });

  it('stores the replayed name only after extra marks are removed', () => {
    const stacked = `x${'\u0301'.repeat(8)}y`;
    const base = createMatch(1_700_000_000_000);
    const prepared = prepareLiveLog({
      schemaVersion: 2,
      base,
      events: [{ type: 'team/rename', team: 'a', name: stacked, at: base.createdAt + 1 }],
    });
    const played = replayScore(prepared.base, prepared.events);
    expect(played.teams.a.name).not.toBe(stacked);
    expect(parseLiveTeamName(played.teams.a.name)).toBe(played.teams.a.name);
    expect(clampLiveTeamName('भारतीय टीम', 'a')).toBe('भारतीय टीम');
    const clampedBase = prepareLiveLog({
      schemaVersion: 2,
      base: createMatch(1_700_000_000_000, undefined, { a: stacked }),
      events: [],
    });
    expect(parseLiveTeamName(clampedBase.base.teams.a.name)).toBe(clampedBase.base.teams.a.name);
  });
});
