import { describe, expect, it } from 'vitest';
import {
  CELEBRATED_KEY,
  acknowledgeCelebrated,
  celebrationKey,
  currentWin,
  forgetCelebratedMatch,
  loadCelebrated,
  saveCelebrated,
  shouldCelebrate,
  winBeganOnLastEvent,
} from './celebration';
import { sessionReducer } from './session';
import { MAX_EVENTS, appendEvent, createLog, replay, undoLog, type MatchLog } from './log';
import type { MatchStorage } from './persistence';
import { createMatch, matchReducer } from './reducer';
import type { SetIndex, TeamId } from './types';

const ID = '00000000-0000-4000-8000-00000000000c';
const NEXT = '00000000-0000-4000-8000-00000000000d';
const T0 = 1_700_000_000_000;

function games(log: MatchLog, team: TeamId, count: number, at: number): MatchLog {
  let next = log;
  for (let i = 0; i < count; i += 1) {
    next = appendEvent(next, { type: 'game/increment', team, at: at + i });
  }
  return next;
}

function memory(): MatchStorage & { readonly dump: () => Map<string, string> } {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    dump: () => store,
  };
}

function wonLog(): MatchLog {
  return games(games(createLog(T0, ID), 'a', 6, T0 + 1), 'a', 6, T0 + 20);
}

function lastAt(log: MatchLog): number {
  const event = log.events[log.events.length - 1];
  if (!event) throw new Error('expected an event');
  return event.at;
}

describe('celebration keys', () => {
  it('celebrates the winning point once, not a later game while the match stays won', () => {
    const won = wonLog();
    const win = currentWin(won);
    expect(win).toEqual({ matchId: ID, at: lastAt(won) });
    expect(celebrationKey(win ?? { matchId: ID, at: 0 })).toBe(`${ID}:${lastAt(won)}`);
    expect(winBeganOnLastEvent(won)).toBe(true);
    expect(shouldCelebrate(won, null)).toBe(true);

    const third = appendEvent(
      appendEvent(won, { type: 'set/select', index: 2, at: T0 + 40 }),
      { type: 'game/increment', team: 'a', at: T0 + 41 },
    );
    expect(currentWin(third)).toEqual(win);
    expect(winBeganOnLastEvent(third)).toBe(false);
    expect(shouldCelebrate(third, null)).toBe(false);
    expect(shouldCelebrate(appendEvent(third, { type: 'game/increment', team: 'b', at: T0 + 42 }), null)).toBe(false);
  });

  it('celebrates again after minus removes the win', () => {
    const won = wonLog();
    const first = currentWin(won);
    const removed = appendEvent(won, { type: 'game/decrement', team: 'a', at: T0 + 40 });
    expect(currentWin(removed)).toBeNull();
    expect(shouldCelebrate(removed, first)).toBe(false);

    const again = appendEvent(removed, { type: 'game/increment', team: 'a', at: T0 + 41 });
    expect(currentWin(again)).toEqual({ matchId: ID, at: T0 + 41 });
    expect(shouldCelebrate(again, first)).toBe(true);
    expect(shouldCelebrate(again, currentWin(again))).toBe(false);
  });

  it('celebrates again after undo deletes the winning event', () => {
    const won = wonLog();
    const first = currentWin(won);
    const undone = undoLog(won);
    expect(currentWin(undone)).toBeNull();
    expect(shouldCelebrate(undone, first)).toBe(false);

    const again = appendEvent(undone, { type: 'game/increment', team: 'a', at: T0 + 80 });
    const second = currentWin(again);
    expect(second).toEqual({ matchId: ID, at: T0 + 80 });
    expect(first && second && celebrationKey(second) !== celebrationKey(first)).toBe(true);
    expect(shouldCelebrate(again, first)).toBe(true);
  });

  it('does not celebrate End match on a one-set lead', () => {
    const ended = appendEvent(games(createLog(T0, ID), 'b', 6, T0 + 1), { type: 'match/end', at: T0 + 20 });
    expect(currentWin(ended)).toBeNull();
    expect(shouldCelebrate(ended, null)).toBe(false);
    const undone = undoLog(ended);
    expect(currentWin(undone)).toBeNull();
    const again = appendEvent(undone, { type: 'match/end', at: T0 + 30 });
    expect(currentWin(again)).toBeNull();
  });

  it('does not treat End match on an already decided score as a new win', () => {
    const won = wonLog();
    const ended = appendEvent(won, { type: 'match/end', at: T0 + 40 });
    expect(currentWin(ended)).toEqual(currentWin(won));
    expect(shouldCelebrate(ended, null)).toBe(false);
  });

  it('does not celebrate an early end, and resume does not create a win', () => {
    const lead = appendEvent(games(createLog(T0, ID), 'b', 6, T0 + 1), { type: 'match/end', at: T0 + 20 });
    expect(currentWin(lead)).toBeNull();
    expect(shouldCelebrate(lead, null)).toBe(false);
    const resumed = appendEvent(lead, { type: 'match/resume', at: T0 + 21 });
    expect(currentWin(resumed)).toBeNull();
    const endedAgain = appendEvent(resumed, { type: 'match/end', at: T0 + 22 });
    expect(currentWin(endedAgain)).toBeNull();
  });

  it('starts a fresh key on a new match', () => {
    const fresh = appendEvent(wonLog(), { type: 'match/new', matchId: NEXT, at: T0 + 40 });
    expect(currentWin(fresh)).toBeNull();
    const wonAgain = games(games(fresh, 'a', 6, T0 + 50), 'a', 6, T0 + 70);
    const win = currentWin(wonAgain);
    expect(win).toEqual({ matchId: NEXT, at: lastAt(wonAgain) });
    expect(shouldCelebrate(wonAgain, { matchId: ID, at: T0 + 25 })).toBe(true);
  });

  it('keeps the winning timestamp after older events are folded past the limit', () => {
    let log = createLog(T0, ID);
    for (let i = 0; i < MAX_EVENTS; i += 1) {
      const index: SetIndex = i % 2 === 0 ? 1 : 0;
      log = appendEvent(log, { type: 'set/select', index, at: T0 + 1 + i });
    }
    log = games(games(log, 'a', 6, T0 + 10_000), 'a', 6, T0 + 10_100);
    const wonAt = lastAt(log);
    expect(currentWin(log)).toEqual({ matchId: ID, at: wonAt });
    expect(log.events.length).toBe(MAX_EVENTS);
    expect(log.events.some((event) => event.at === wonAt)).toBe(true);

    log = appendEvent(log, { type: 'set/select', index: 2, at: T0 + 11_000 });
    log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 11_001 });
    expect(currentWin(log)).toEqual({ matchId: ID, at: wonAt });
    expect(winBeganOnLastEvent(log)).toBe(false);
    expect(shouldCelebrate(log, { matchId: ID, at: wonAt })).toBe(false);
  });

  it('does not celebrate a compacted log whose win is already in the base', () => {
    let state = createMatch(T0, ID);
    for (let i = 0; i < 12; i += 1) {
      state = matchReducer(state, { type: 'game/increment', team: 'a', at: T0 + 1 + i });
    }
    const log: MatchLog = {
      schemaVersion: state.schemaVersion,
      base: state,
      events: [{ type: 'set/select', index: 2, at: T0 + 30 }],
    };
    expect(currentWin(log)).toEqual({ matchId: ID, at: state.updatedAt });
    expect(winBeganOnLastEvent(log)).toBe(false);
    expect(shouldCelebrate(log, null)).toBe(false);
  });

  it('remembers an already won match on first start and ignores a broken value', () => {
    const storage = memory();
    const won = wonLog();
    const win = currentWin(won);
    expect(loadCelebrated(storage)).toBeNull();
    expect(acknowledgeCelebrated(createLog(T0, ID), storage)).toBeNull();
    expect(acknowledgeCelebrated(won, storage)).toEqual(win);
    expect(loadCelebrated(storage)).toEqual(win);
    expect(storage.dump().get(CELEBRATED_KEY)).toBe(`{"matchId":"${ID}","at":${win?.at ?? 0}}`);
    expect(acknowledgeCelebrated(won, storage)).toEqual(win);
    expect(shouldCelebrate(won, loadCelebrated(storage))).toBe(false);

    expect(saveCelebrated({ matchId: ID, at: T0 + 25 }, storage)).toBe(true);
    expect(loadCelebrated(storage)).toEqual({ matchId: ID, at: T0 + 25 });

    storage.setItem(CELEBRATED_KEY, '{');
    expect(loadCelebrated(storage)).toBeNull();
    storage.setItem(CELEBRATED_KEY, JSON.stringify({ matchId: 'nope', at: T0 + 1 }));
    expect(loadCelebrated(storage)).toBeNull();
    storage.setItem(CELEBRATED_KEY, JSON.stringify({ matchId: ID, episode: 1 }));
    expect(loadCelebrated(storage)).toBeNull();
    storage.setItem(CELEBRATED_KEY, JSON.stringify({ matchId: ID, at: 0 }));
    expect(loadCelebrated(storage)).toBeNull();
    storage.setItem(CELEBRATED_KEY, 'x'.repeat(201));
    expect(loadCelebrated(storage)).toBeNull();
  });

  it('forgets a celebrated win only when that match is deleted', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    saveCelebrated({ matchId: ID, at: T0 + 1 }, storage);
    forgetCelebratedMatch(NEXT, storage);
    expect(loadCelebrated(storage)).toEqual({ matchId: ID, at: T0 + 1 });
    forgetCelebratedMatch(ID, storage);
    expect(store.has(CELEBRATED_KEY)).toBe(false);
    expect(loadCelebrated(storage)).toBeNull();

    const blocked = {
      getItem: () => JSON.stringify({ matchId: ID, at: T0 + 1 }),
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => forgetCelebratedMatch(ID, blocked)).not.toThrow();
  });

  it('does not need a celebrated key back, because undo cannot restore the deleted match', () => {
    const won = wonLog();
    const win = currentWin(won);
    expect(win).not.toBeNull();
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    saveCelebrated(win ?? { matchId: ID, at: T0 }, storage);
    const archived = sessionReducer(
      { log: won, archive: [] },
      { type: 'record', event: { type: 'match/new', matchId: NEXT, at: T0 + 40 } },
    );
    const deleted = sessionReducer(archived, { type: 'delete-match', id: ID });
    forgetCelebratedMatch(ID, storage);
    expect(loadCelebrated(storage)).toBeNull();

    let undone = deleted;
    for (let step = 0; step < 30; step += 1) {
      const next = sessionReducer(undone, { type: 'undo' });
      expect(replay(next.log).matchId).not.toBe(ID);
      if (next.log === undone.log) break;
      undone = next;
    }
    expect(replay(undone.log).matchId).toBe(NEXT);
    expect(loadCelebrated(storage)).toBeNull();
    expect(shouldCelebrate(undone.log, null)).toBe(false);
  });
});
