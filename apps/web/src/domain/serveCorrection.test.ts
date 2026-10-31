import { describe, expect, it } from 'vitest';
import { appendEvent, createLog, replay } from './log';
import { replayScore } from './reducer';
import { tiebreakHint } from './rules';
import type { MatchEvent, TeamId } from './types';

const ID = '00000000-0000-4000-8000-0000000000aa';
const T0 = 1_700_000_000_000;

function play(events: readonly MatchEvent[]) {
  return events.reduce((log, event) => appendEvent(log, event), createLog(T0, ID));
}

function point(type: 'game/increment' | 'game/decrement', team: TeamId, at: number): MatchEvent {
  return { type, team, at };
}

describe('court log minus', () => {
  it('names the 6:6 server again after Plus to 7:6 and Minus', () => {
    const events: MatchEvent[] = [{ type: 'serve/set', team: 'a', player: 1, at: T0 + 1 }];
    let at = T0 + 2;
    for (let i = 0; i < 6; i += 1) {
      events.push(point('game/increment', 'a', at));
      at += 1;
      events.push(point('game/increment', 'b', at));
      at += 1;
    }
    const tied = replay(play(events));
    expect(tied.sets[0]).toEqual({ a: 6, b: 6 });
    expect(tiebreakHint(tied)).toContain('Team A player 1 serves 1 point, from the right');

    const ahead = play([...events, point('game/increment', 'b', at)]);
    expect(replay(ahead).serve).toBeNull();
    expect(replay(ahead).serveAsk).toBe('b');
    expect(replay(ahead).activeSet).toBe(1);

    const back = replay(appendEvent(ahead, point('game/decrement', 'b', at + 1)));
    expect(back.sets[0]).toEqual({ a: 6, b: 6 });
    expect(back.activeSet).toBe(0);
    expect(back.serve).toEqual({ team: 'a', player: 1 });
    expect(back.serveAsk).toBeNull();
    expect(back.servePrompt).toBe(false);
    expect(tiebreakHint(back)).toContain('Team A player 1 serves 1 point, from the right');
    expect(back).toEqual(replayScore(createLog(T0, ID).base, [...events, point('game/increment', 'b', at), point('game/decrement', 'b', at + 1)]));
  });

  it('steps back into a finished set and through several corrections', () => {
    const events: MatchEvent[] = [{ type: 'serve/set', team: 'a', player: 1, at: T0 + 1 }];
    let at = T0 + 2;
    for (let i = 0; i < 6; i += 1) {
      events.push(point('game/increment', 'a', at));
      at += 1;
    }
    const won = play(events);
    expect(replay(won).activeSet).toBe(1);
    expect(replay(won).sets[0]).toEqual({ a: 6, b: 0 });
    const cleared = appendEvent(won, { type: 'serve/set', team: null, player: null, at });
    expect(replay(cleared).serve).toBeNull();
    const returned = replay(appendEvent(cleared, point('game/decrement', 'a', at + 1)));
    expect(returned.sets[0]).toEqual({ a: 5, b: 0 });
    expect(returned.activeSet).toBe(0);
    expect(returned.serve).toEqual({ team: 'b', player: 1 });

    const rally: MatchEvent[] = [
      { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 },
      point('game/increment', 'a', T0 + 2),
      { type: 'serve/set', team: 'a', player: 2, at: T0 + 3 },
      point('game/increment', 'b', T0 + 4),
      point('game/increment', 'a', T0 + 5),
    ];
    let log = play(rally);
    log = appendEvent(log, point('game/decrement', 'a', T0 + 6));
    expect(replay(log).serve).toEqual({ team: 'b', player: 1 });
    log = appendEvent(log, point('game/decrement', 'b', T0 + 7));
    expect(replay(log).serve).toEqual({ team: 'a', player: 2 });
    log = appendEvent(log, point('game/decrement', 'a', T0 + 8));
    expect(replay(log).sets[0]).toEqual({ a: 0, b: 0 });
    expect(replay(log).serve).toEqual({ team: 'a', player: 1 });
    expect(replay(log).serveAsk).toBeNull();
    expect(replay(log).servePrompt).toBe(false);
  });
});
