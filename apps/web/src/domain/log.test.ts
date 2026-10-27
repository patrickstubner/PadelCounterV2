import { describe, expect, it } from 'vitest';
import { appendEvent, createLog, describeEvent, formatEventTime, formatMatchStamp, replay, undoLog } from './log';
import type { MatchEvent } from './types';

const ID = '00000000-0000-4000-8000-00000000000c';
const NEXT = '00000000-0000-4000-8000-00000000000d';
const T0 = 1_700_000_000_000;

describe('match log', () => {
  it('undoes games, serve, names, and a new match one step at a time', () => {
    let log = createLog(T0, ID, { a: 'Nord', b: 'Süd' });
    log = appendEvent(log, { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 2 });
    log = appendEvent(log, { type: 'team/rename', team: 'b', name: 'Hafen', at: T0 + 3 });
    log = appendEvent(log, { type: 'match/reset', matchId: NEXT, at: T0 + 4 });

    expect(replay(log).matchId).toBe(NEXT);
    expect(replay(log).sets[0]).toEqual({ a: 0, b: 0 });
    expect(replay(log).serve).toBeNull();
    expect(replay(log).teams.a.name).toBe('Nord');
    expect(replay(log).teams.b.name).toBe('Hafen');

    log = undoLog(log);
    expect(replay(log).matchId).toBe(ID);
    expect(replay(log).teams.b.name).toBe('Hafen');
    expect(replay(log).serve).toEqual({ team: 'b', player: 1 });

    log = undoLog(log);
    expect(replay(log).teams.b.name).toBe('Süd');

    log = undoLog(log);
    expect(replay(log).sets[0]).toEqual({ a: 0, b: 0 });
    expect(replay(log).serve).toEqual({ team: 'a', player: 1 });

    log = undoLog(log);
    expect(replay(log).serve).toBeNull();
    expect(undoLog(log)).toBe(log);
  });

  it('does not store a no-op and keeps at most 500 events', () => {
    let log = createLog(T0, ID);
    const ignored = appendEvent(log, { type: 'serve/set', team: null, player: null, at: T0 + 1 });
    expect(ignored).toBe(log);

    for (let i = 0; i < 501; i += 1) {
      const event: MatchEvent = { type: 'team/rename', team: 'a', name: `N${i}`, at: T0 + 2 + i };
      log = appendEvent(log, event);
    }
    expect(log.events).toHaveLength(500);
    expect(log.events[0]).toMatchObject({ name: 'N1' });
    expect(replay(log).teams.a.name).toBe('N500');
    expect(replay(log).revision).toBe(501);

    log = undoLog(log);
    expect(replay(log).teams.a.name).toBe('N499');
  });

  it('stores a set change in the log and undoes the correction', () => {
    let log = createLog(T0, ID);
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 1 });
    log = appendEvent(log, { type: 'set/select', index: 1, at: T0 + 2 });
    expect(log.events.at(-1)).toMatchObject({ type: 'set/select', index: 1 });
    expect(describeEvent(log.events.at(-1)!)).toBe('Set 2');
    expect(replay(log).activeSet).toBe(1);
    expect(replay(log).sets[0]).toEqual({ a: 1, b: 0 });

    log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 3 });
    expect(replay(log).sets[1]).toEqual({ a: 0, b: 1 });

    log = undoLog(log);
    expect(replay(log).sets[1]).toEqual({ a: 0, b: 0 });
    expect(replay(log).activeSet).toBe(1);

    log = undoLog(log);
    expect(replay(log).activeSet).toBe(0);
    expect(replay(log).sets[0]).toEqual({ a: 1, b: 0 });
    expect(appendEvent(log, { type: 'set/select', index: 0, at: T0 + 4 })).toBe(log);
  });

  it('describes events without using the raw rename text as markup', () => {
    expect(describeEvent({ type: 'game/increment', team: 'a', at: T0 })).toBe('Game for A');
    expect(describeEvent({ type: 'game/decrement', team: 'b', at: T0 })).toBe('Game B back');
    expect(describeEvent({ type: 'set/select', index: 2, at: T0 })).toBe('Set 3');
    expect(describeEvent({ type: 'match/reset', matchId: ID, at: T0 })).toBe('New match');
    expect(describeEvent({ type: 'match/new', matchId: ID, at: T0 })).toBe('New match');
    expect(describeEvent({ type: 'serve/set', team: 'a', player: 1, at: T0 })).toBe('Serve A1');
    expect(describeEvent({ type: 'serve/set', team: null, player: null, at: T0 })).toBe('Serve open');
    expect(describeEvent({ type: 'match/end', at: T0 })).toBe('Match ended');
    expect(describeEvent({ type: 'match/resume', at: T0 })).toBe('Resume');
    expect(describeEvent({ type: 'team/rename', team: 'a', name: '<b>Hi</b>', at: T0 })).toBe('Name A · <b>Hi</b>');
    expect(describeEvent({ type: 'match/end', at: T0 })).toBe('Match ended');
    expect(describeEvent({ type: 'match/resume', at: T0 })).toBe('Resume');
  });

  it('undo and resume both reopen an ended match, and timestamps show the local clock', () => {
    let log = createLog(T0, ID);
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 1 });
    log = appendEvent(log, { type: 'match/end', at: T0 + 2 });
    expect(replay(log).ended).toBe(true);
    expect(replay(log).sets[0]).toEqual({ a: 1, b: 0 });

    const undone = undoLog(log);
    expect(replay(undone).ended).toBe(false);
    expect(replay(undone).sets[0]).toEqual({ a: 1, b: 0 });

    log = appendEvent(log, { type: 'match/resume', at: T0 + 3 });
    expect(replay(log).ended).toBe(false);
    log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 4 });
    expect(replay(log).sets[0]).toEqual({ a: 1, b: 1 });
    expect(describeEvent(log.events[1]!)).toBe('Match ended');
    expect(describeEvent(log.events[2]!)).toBe('Resume');

    const now = new Date(2026, 9, 13, 18, 0, 0).getTime();
    expect(formatEventTime(new Date(2026, 9, 13, 14, 5, 9).getTime(), now)).toBe('14:05:09');
    expect(formatEventTime(new Date(2026, 9, 12, 9, 1, 2).getTime(), now)).toBe('10/12/2026 09:01:02');
    expect(formatMatchStamp(new Date(2026, 9, 12, 9, 1, 2).getTime())).toBe('10/12/2026 09:01:02');
  });
});
