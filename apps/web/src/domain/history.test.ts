import { describe, expect, it } from 'vitest';
import { currentHistory, formatHistoryScore } from './history';
import { appendEvent, createLog, replay, undoLog } from './log';

const ID = '00000000-0000-4000-8000-0000000000aa';
const T0 = new Date(2026, 9, 13, 14, 0, 0).getTime();

describe('match history rows', () => {
  it('lists games newest first with the score after each point', () => {
    let log = createLog(T0, ID, { a: 'Team A', b: 'Team B' });
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 1_000 });
    log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 2_000 });
    const rows = currentHistory(log);
    expect(rows.map((row) => formatHistoryScore(row.score))).toEqual(['1:1', '1:0']);
    expect(rows[0]?.score[0]).toMatchObject({ a: 1, b: 1, aChanged: false, bChanged: true });
    expect(rows[1]?.score[0]).toMatchObject({ a: 1, b: 0, aChanged: true, bChanged: false });
    expect(rows.map((row) => row.label)).toEqual(['Team B won the game', 'Team A won the game']);
    const captured = appendEvent(createLog(T0, ID), {
      type: 'game/increment',
      team: 'a',
      at: T0 + 5_000,
      capturedAt: T0 + 1_500,
    });
    expect(currentHistory(captured)[0]?.at).toBe(T0 + 1_500);
    expect(rows[0]?.who).toBeNull();
    log = appendEvent(log, { type: 'game/decrement', team: 'b', at: T0 + 3_000, by: 'host' });
    const corrected = currentHistory(log);
    expect(corrected[0]?.label).toBe('Team B game taken back');
    expect(corrected[0]?.who).toBe('Host');
    expect(rows[0]?.at).toBeGreaterThan(rows[1]?.at ?? 0);
  });

  it('adds the set score when a set is won or the active set changes', () => {
    let log = createLog(T0, ID);
    for (let i = 0; i < 6; i += 1) {
      log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 1_000 + i });
    }
    log = appendEvent(log, { type: 'set/select', index: 0, at: T0 + 8_000 });
    const rows = currentHistory(log);
    expect(rows[0]?.label).toBe('Set 1');
    expect(formatHistoryScore(rows[0]?.score ?? [])).toBe('6:0');
    expect(rows[0]?.score[0]?.aChanged).toBe(false);
    expect(rows[0]?.score[0]?.bChanged).toBe(false);
    expect(formatHistoryScore(rows[1]?.score ?? [])).toBe('6:0');
    expect(rows[1]?.score[0]).toMatchObject({ a: 6, b: 0, aChanged: true, bChanged: false });
    expect(formatHistoryScore(rows.at(-1)?.score ?? [])).toBe('1:0');
    expect(rows.at(-1)?.score[0]?.aChanged).toBe(true);
  });

  it('undoes a B-start rotation back through A1 to B1', () => {
    let log = createLog(T0, ID);
    log = appendEvent(log, { type: 'serve/set', team: 'b', player: 1, at: T0 + 1 });
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 2 });
    expect(replay(log).serve).toEqual({ team: 'a', player: 1 });
    log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 3 });
    expect(replay(log).serve).toEqual({ team: 'b', player: 2 });
    log = undoLog(log);
    expect(replay(log).serve).toEqual({ team: 'a', player: 1 });
    log = undoLog(log);
    expect(replay(log).serve).toEqual({ team: 'b', player: 1 });
    const rows = currentHistory(log);
    expect(rows.map((row) => row.label)).toEqual(['Serve B1']);
  });

  it('restores the tiebreak server when that game is undone', () => {
    let log = createLog(T0, ID);
    log = appendEvent(log, { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
    for (let i = 0; i < 6; i += 1) {
      log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 10 + i * 2 });
      log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 11 + i * 2 });
    }
    expect(replay(log).serve).toEqual({ team: 'a', player: 1 });
    expect(replay(log).servePrompt).toBe(false);
    log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 100 });
    expect(replay(log).sets[0]).toEqual({ a: 6, b: 7 });
    expect(replay(log).serve).toBeNull();
    expect(replay(log).serveAsk).toBe('b');
    expect(replay(log).servePrompt).toBe(false);
    log = undoLog(log);
    expect(replay(log).sets[0]).toEqual({ a: 6, b: 6 });
    expect(replay(log).serve).toEqual({ team: 'a', player: 1 });
    expect(replay(log).serveAsk).toBeNull();
    expect(replay(log).servePrompt).toBe(false);
  });

  it('restores the pending team when the game after a tiebreak is undone', () => {
    let log = createLog(T0, ID);
    log = appendEvent(log, { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
    for (let i = 0; i < 6; i += 1) {
      log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 10 + i * 2 });
      log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 11 + i * 2 });
    }
    log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 100 });
    expect(replay(log).serveAsk).toBe('b');
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 101 });
    expect(replay(log).sets[1]).toEqual({ a: 1, b: 0 });
    expect(replay(log).serve).toBeNull();
    expect(replay(log).serveAsk).toBe('a');
    log = undoLog(log);
    expect(replay(log).serveAsk).toBe('b');
    expect(replay(log).serve).toBeNull();
  });

  it('shows every set and highlights only the number that changed', () => {
    const reached = (finish: 'a' | 'b') => {
      let log = createLog(T0, ID);
      let at = T0;
      const point = (team: 'a' | 'b') => {
        at += 1;
        log = appendEvent(log, { type: 'game/increment', team, at });
      };
      for (let i = 0; i < 3; i += 1) {
        point('a');
        point('b');
      }
      for (let i = 0; i < 3; i += 1) point('a');
      for (let i = 0; i < 5; i += 1) point('a');
      point(finish);
      return currentHistory(log)[0];
    };

    const toOne = reached('b');
    const toSix = reached('a');
    expect(formatHistoryScore(toOne?.score ?? [])).toBe('6:3 5:1');
    expect(toOne?.score[0]).toMatchObject({ aChanged: false, bChanged: false });
    expect(toOne?.score[1]).toMatchObject({ a: 5, b: 1, aChanged: false, bChanged: true });
    expect(formatHistoryScore(toSix?.score ?? [])).toBe('6:3 6:0');
    expect(toSix?.score[1]).toMatchObject({ a: 6, b: 0, aChanged: true, bChanged: false });
    expect(toSix?.label).toBe('Team A won the game');
  });
});
