import { describe, expect, it } from 'vitest';
import { createLog, replay, undoLog } from './log';
import { createMatch } from './reducer';
import {
  MAX_RAW_LENGTH,
  STORAGE_KEY,
  loadLog,
  parsePersisted,
  saveLog,
  serializeLog,
  type MatchStorage,
} from './persistence';
import type { MatchState } from './types';

const ID = '00000000-0000-4000-8000-00000000000a';
const NEXT = '00000000-0000-4000-8000-00000000000b';
const T0 = 1_700_000_000_000;

function memory(): MatchStorage & { dump(): Map<string, string> } {
  const data = new Map<string, string>();
  return {
    dump: () => data,
    getItem: (key) => (data.has(key) ? (data.get(key) ?? null) : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function validLog() {
  let log = createLog(T0, ID, { a: 'A < B', b: 'Möwe' });
  log = {
    ...log,
    events: [{ type: 'game/increment', team: 'a', at: T0 + 1 }],
  };
  return log;
}

function v1Envelope(state: MatchState) {
  return {
    schemaVersion: 1,
    state: {
      schemaVersion: 1,
      matchId: state.matchId,
      revision: state.revision,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      activeSet: state.activeSet,
      teams: state.teams,
      sets: state.sets,
    },
  };
}

describe('parsePersisted', () => {
  it('round-trips a log and lowercases the id', () => {
    const log = validLog();
    const raw = serializeLog(log).replace(ID, ID.toUpperCase());
    const loaded = parsePersisted(JSON.parse(raw) as unknown);
    expect(loaded?.base.matchId).toBe(ID);
    expect(loaded?.base.teams.a.name).toBe('A < B');
    expect(loaded?.base.teams.b.name).toBe('Möwe');
    expect(replay(loaded!).sets[0]).toEqual({ a: 1, b: 0 });
    expect(replay(loaded!).revision).toBe(1);
    expect(replay(loaded!).serve).toBeNull();
    expect(replay(loaded!).ended).toBe(false);
  });

  it('keeps an ended match and rejects a forged status', () => {
    let log = validLog();
    log = {
      ...log,
      events: [...log.events, { type: 'match/end', at: T0 + 2 }],
    };
    const loaded = parsePersisted(JSON.parse(serializeLog(log)) as unknown);
    expect(replay(loaded!).ended).toBe(true);
    expect(replay(loaded!).sets[0]).toEqual({ a: 1, b: 0 });

    const legacy = JSON.parse(serializeLog(validLog())) as { base: Record<string, unknown> };
    delete legacy.base.ended;
    expect(parsePersisted(legacy)?.base.ended).toBe(false);

    const forged = JSON.parse(serializeLog(validLog())) as { base: Record<string, unknown> };
    forged.base.ended = 'yes';
    expect(parsePersisted(forged)).toBeNull();

    const missingPrompt = JSON.parse(serializeLog(validLog())) as { base: Record<string, unknown> };
    delete missingPrompt.base.servePrompt;
    expect(parsePersisted(missingPrompt)?.base.servePrompt).toBe(false);
    const forgedPrompt = JSON.parse(serializeLog(validLog())) as { base: Record<string, unknown> };
    forgedPrompt.base.servePrompt = 'yes';
    expect(parsePersisted(forgedPrompt)).toBeNull();

    const asked = JSON.parse(serializeLog(validLog())) as { base: Record<string, unknown> };
    asked.base.serveAsk = 'b';
    expect(parsePersisted(asked)?.base.serveAsk).toBe('b');
    const missingAsk = JSON.parse(serializeLog(validLog())) as { base: Record<string, unknown> };
    delete missingAsk.base.serveAsk;
    expect(parsePersisted(missingAsk)?.base.serveAsk).toBeNull();
    const forgedAsk = JSON.parse(serializeLog(validLog())) as { base: Record<string, unknown> };
    forgedAsk.base.serveAsk = 'c';
    expect(parsePersisted(forgedAsk)).toBeNull();

    const badResume = JSON.parse(serializeLog(validLog())) as { events: unknown[] };
    badResume.events = [{ type: 'match/resume', at: 'now' }];
    expect(parsePersisted(badResume)).toBeNull();
  });

  it('migrates a version-1 snapshot and drops any forged serve', () => {
    const state = createMatch(T0, ID, { a: 'Alt', b: 'Team B' });
    const legacy = v1Envelope(state) as { state: Record<string, unknown> };
    legacy.state.serve = { team: 'a', player: 1 };
    const loaded = parsePersisted(legacy);
    expect(loaded?.events).toEqual([]);
    expect(loaded?.base.schemaVersion).toBe(2);
    expect(loaded?.base.serve).toBeNull();
    expect(loaded?.base.teams.a.name).toBe('Alt');
  });

  it('rejects a wrong schema, corrupt shapes, impossible scores, and bad events', () => {
    const log = validLog();
    const envelope = JSON.parse(serializeLog(log)) as {
      schemaVersion: number;
      base: Record<string, unknown>;
      events: unknown[];
    };
    expect(parsePersisted({ ...envelope, schemaVersion: 3 })).toBeNull();
    expect(parsePersisted({ schemaVersion: 2 })).toBeNull();
    expect(parsePersisted({ schemaVersion: 1 })).toBeNull();
    expect(parsePersisted(null)).toBeNull();
    expect(parsePersisted([])).toBeNull();
    expect(parsePersisted('nope')).toBeNull();

    const badSets = structuredClone(envelope);
    badSets.base.sets = [{ a: 7, b: 4 }, { a: 0, b: 0 }, { a: 0, b: 0 }];
    expect(parsePersisted(badSets)).toBeNull();

    const tooLong = structuredClone(envelope);
    const teams = tooLong.base.teams as { a: { name: string } };
    teams.a.name = '123456789012345678901';
    expect(parsePersisted(tooLong)).toBeNull();

    const control = structuredClone(envelope);
    (control.base.teams as { a: { name: string } }).a.name = 'Bad\nName';
    expect(parsePersisted(control)).toBeNull();

    const active = structuredClone(envelope);
    active.base.activeSet = 3;
    expect(parsePersisted(active)).toBeNull();

    const fractional = structuredClone(envelope);
    (fractional.base.sets as Array<{ a: number; b: number }>)[0] = { a: 1.5, b: 0 };
    expect(parsePersisted(fractional)).toBeNull();

    const badServe = structuredClone(envelope);
    badServe.base.serve = { team: 'a', player: 3 };
    expect(parsePersisted(badServe)).toBeNull();

    const badEvent = structuredClone(envelope);
    badEvent.events = [{ type: 'serve/set', team: 'a', player: null, at: T0 + 1 }];
    expect(parsePersisted(badEvent)).toBeNull();

    const unknownEvent = structuredClone(envelope);
    unknownEvent.events = [{ type: 'game/steal', team: 'a', at: T0 + 1 }];
    expect(parsePersisted(unknownEvent)).toBeNull();

    const emojiName = structuredClone(envelope);
    emojiName.events = [{ type: 'team/rename', team: 'a', name: '🎾'.repeat(80), at: T0 + 2 }];
    expect(parsePersisted(emojiName)?.events).toHaveLength(1);
    const tooManyPoints = structuredClone(envelope);
    tooManyPoints.events = [{ type: 'team/rename', team: 'a', name: '🎾'.repeat(81), at: T0 + 2 }];
    expect(parsePersisted(tooManyPoints)).toBeNull();

    const tooMany = structuredClone(envelope);
    tooMany.events = Array.from({ length: 501 }, (_, index) => ({
      type: 'set/select',
      index: 1,
      at: T0 + 1 + index,
    }));
    expect(parsePersisted(tooMany)).toBeNull();
  });

  it('does not pollute Object.prototype and survives throwing getters', () => {
    const payload = JSON.parse(
      '{"schemaVersion":2,"__proto__":{"polluted":true},"base":{"schemaVersion":2}}',
    ) as unknown;
    expect(parsePersisted(payload)).toBeNull();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, 'schemaVersion', {
      get() {
        throw new Error('boom');
      },
    });
    expect(parsePersisted(evil)).toBeNull();
  });
});

describe('1.2.4 history upgrade', () => {
  it('keeps names from an old New match, and undo across that step restores the previous score', () => {
    const saved = JSON.parse(serializeLog(createLog(T0, ID))) as { events: unknown[] };
    saved.events = [
      { type: 'team/rename', team: 'a', name: 'Lobos', at: T0 + 1 },
      { type: 'team/rename', team: 'b', name: 'Wolves', at: T0 + 2 },
      { type: 'game/increment', team: 'a', at: T0 + 3 },
      { type: 'match/reset', matchId: NEXT, at: T0 + 4 },
      { type: 'game/increment', team: 'b', at: T0 + 5 },
    ];
    const loaded = parsePersisted(saved);
    expect(loaded?.events[3]).toEqual({ type: 'match/reset', matchId: NEXT, at: T0 + 4 });

    const live = replay(loaded!);
    expect(live.matchId).toBe(NEXT);
    expect(live.teams.a.name).toBe('Lobos');
    expect(live.teams.b.name).toBe('Wolves');
    expect(live.sets[0]).toEqual({ a: 0, b: 1 });

    const beforeLastGame = undoLog(loaded!);
    expect(replay(beforeLastGame).matchId).toBe(NEXT);
    expect(replay(beforeLastGame).teams.a.name).toBe('Lobos');
    expect(replay(beforeLastGame).teams.b.name).toBe('Wolves');
    expect(replay(beforeLastGame).sets[0]).toEqual({ a: 0, b: 0 });

    const beforeReset = undoLog(beforeLastGame);
    expect(replay(beforeReset).matchId).toBe(ID);
    expect(replay(beforeReset).teams.a.name).toBe('Lobos');
    expect(replay(beforeReset).teams.b.name).toBe('Wolves');
    expect(replay(beforeReset).sets[0]).toEqual({ a: 1, b: 0 });
  });
});

describe('loadLog / saveLog', () => {
  it('persists and reloads', () => {
    const storage = memory();
    const log = validLog();
    expect(saveLog(log, storage)).toBe(true);
    expect(storage.dump().get(STORAGE_KEY)).toContain('"schemaVersion":2');
    expect(loadLog(storage)).toEqual(log);
  });

  it('returns null for missing, huge, and broken payloads', () => {
    const storage = memory();
    expect(loadLog(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, '{');
    expect(loadLog(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, 'x'.repeat(MAX_RAW_LENGTH + 1));
    expect(loadLog(storage)).toBeNull();
  });

  it('swallows storage failures', () => {
    const broken: MatchStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('quota');
      },
    };
    expect(loadLog(broken)).toBeNull();
    expect(saveLog(validLog(), broken)).toBe(false);
  });
});
