import type { MatchEvent, PlayerSlot, SetIndex, TeamId } from './types';

/**
 * Kurzschrift für Golden-Sequenzen (nur Tests):
 * `a`/`b` Game, `-a`/`-b` Minus, `s0..s2` Satzwahl, `sv:a1` Aufschlag, `sv:-` Aufschlag löschen,
 * `end`, `resume`, `new:<uuid>`, `rn:<team>:<name>`.
 */
export function expand(seq: string, start = 1_700_000_000_000): MatchEvent[] {
  let at = start;
  return seq
    .split(/\s+/)
    .filter(Boolean)
    .map((token): MatchEvent => {
      at += 60_000;
      if (token === 'a' || token === 'b') return { type: 'game/increment', team: token, at };
      if (token === '-a' || token === '-b') return { type: 'game/decrement', team: token.slice(1) as TeamId, at };
      if (/^s[0-2]$/.test(token)) return { type: 'set/select', index: Number(token.slice(1)) as SetIndex, at };
      if (token === 'sv:-') return { type: 'serve/set', team: null, player: null, at };
      if (/^sv:[ab][12]$/.test(token))
        return { type: 'serve/set', team: token[3] as TeamId, player: Number(token[4]) as PlayerSlot, at };
      if (token === 'end') return { type: 'match/end', at };
      if (token === 'resume') return { type: 'match/resume', at };
      if (token.startsWith('new:')) return { type: 'match/new', matchId: token.slice(4), at };
      if (token.startsWith('rn:')) {
        const [, team, ...name] = token.split(':');
        return { type: 'team/rename', team: team as TeamId, name: name.join(':'), at };
      }
      throw new Error(`unbekanntes Token ${token}`);
    });
}
