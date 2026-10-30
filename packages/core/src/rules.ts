import type { MatchState, PlayerSlot, Server, SetIndex, SetScore, TeamId } from './types';

export const RULES_SUMMARY =
  'This counter ends a set at 6 games with a lead of 2, at 7–5, or at 7–6 after 6–6. A match is best of 3. Serve is optional and rotates between teams and partners. Tap a set to select it.';

/**
 * Serve cues follow the International Padel Federation Rules of Padel,
 * review of application 1 January 2026. The PDF is the December 2025 file
 * (site title “Rules of Padel - 18 Dec_REV”):
 * https://padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf
 * Checked 2026-10-30.
 * Rule 4 (toss: serve or side), tie-break points 3 and 5, Rule 5.2 (ends every 6 points),
 * Rule 6.5 (sides alternate), Rule 6.8 (each set, the pair chooses who serves first).
 * The older case “the player who began the set serves the tie-break” is in the
 * November 2024 PDF and is not in this December 2025 text. This counter names
 * the server already shown for the 6–6 game, which is whose turn it is when
 * the rotation has been followed. It does not score tie-break points.
 */
export const FIP_SERVE_SOURCE =
  'International Padel Federation, Rules of Padel, review of application 1 January 2026, PDF December 2025 (checked 2026-10-30). https://padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf';

export const CHOOSE_SERVE_TEXT = 'Please choose the serving team';

function otherTeam(team: TeamId): TeamId {
  return team === 'a' ? 'b' : 'a';
}

/**
 * Order once a team has served the first game.
 * A starts: A1, B1, A2, B2. B starts: B1, A1, B2, A2.
 */
export function serveCycle(start: TeamId): readonly [Server, Server, Server, Server] {
  const other = otherTeam(start);
  return [
    { team: start, player: 1 },
    { team: other, player: 1 },
    { team: start, player: 2 },
    { team: other, player: 2 },
  ];
}

/** Games already scored. The server on the court is the server of this index. */
export function gamesPlayed(sets: readonly SetScore[]): number {
  return sets.reduce((sum, set) => sum + set.a + set.b, 0);
}

/**
 * Team that served game 0, if `server` is exactly who should serve game `gamesPlayed`
 * in one of the two cycles. Null when the chosen player does not sit on that slot.
 */
export function inferServeStart(gamesPlayedCount: number, server: Server): TeamId | null {
  const slot = ((gamesPlayedCount % 4) + 4) % 4;
  for (const start of ['a', 'b'] as const) {
    const expected = serveCycle(start)[slot];
    if (expected && expected.team === server.team && expected.player === server.player) return start;
  }
  return null;
}

/** Who served the first game, walking the matching cycle back from the current server. */
export function openingServer(gamesPlayedCount: number, server: Server): Server | null {
  const start = inferServeStart(gamesPlayedCount, server);
  if (!start) return null;
  return serveCycle(start)[0];
}

export function isPlausibleSetScore(a: number, b: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
  if (a < 0 || b < 0 || a > 7 || b > 7) return false;
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  if (high <= 6) return true;
  return low === 5 || low === 6;
}

/** Set is won at 6 with a two-game lead (includes 7:5) or 7:6 after a tiebreak. */
export function setWinner(a: number, b: number): TeamId | null {
  if (!isPlausibleSetScore(a, b)) return null;
  if (a >= 6 && a - b >= 2) return 'a';
  if (b >= 6 && b - a >= 2) return 'b';
  if (a === 7 && b === 6) return 'a';
  if (b === 7 && a === 6) return 'b';
  return null;
}

export function matchWinner(sets: readonly [SetScore, SetScore, SetScore]): TeamId | null {
  const lead = setLead(sets);
  if (lead.a >= 2) return 'a';
  if (lead.b >= 2) return 'b';
  return null;
}

/**
 * What the court may call the result.
 * A winner exists only when a team has two sets. Ending early is a lead or a draw, never a win.
 */
export type MatchResult =
  | { readonly kind: 'playing' }
  | { readonly kind: 'winner'; readonly team: TeamId }
  | { readonly kind: 'leading'; readonly team: TeamId }
  | { readonly kind: 'draw' };

function gameLead(sets: readonly [SetScore, SetScore, SetScore]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const set of sets) {
    a += set.a;
    b += set.b;
  }
  return { a, b };
}

export function matchResult(state: MatchState): MatchResult {
  const decided = matchWinner(state.sets);
  if (decided) return { kind: 'winner', team: decided };
  if (!state.ended) return { kind: 'playing' };
  const sets = setLead(state.sets);
  if (sets.a !== sets.b) return { kind: 'leading', team: sets.a > sets.b ? 'a' : 'b' };
  const games = gameLead(state.sets);
  if (games.a !== games.b) return { kind: 'leading', team: games.a > games.b ? 'a' : 'b' };
  return { kind: 'draw' };
}

function setLead(sets: readonly [SetScore, SetScore, SetScore]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const set of sets) {
    const winner = setWinner(set.a, set.b);
    if (winner === 'a') a += 1;
    if (winner === 'b') b += 1;
  }
  return { a, b };
}

/** Celebration only when the match is won by two sets. An early ending stays quiet. */
export function celebrationWinner(state: MatchState): TeamId | null {
  const result = matchResult(state);
  return result.kind === 'winner' ? result.team : null;
}

export function canIncrement(score: SetScore, team: TeamId): boolean {
  const next: SetScore = { a: score.a, b: score.b, [team]: score[team] + 1 };
  return isPlausibleSetScore(next.a, next.b);
}

export function canDecrement(score: SetScore, team: TeamId): boolean {
  if (score[team] <= 0) return false;
  const next: SetScore = { a: score.a, b: score.b, [team]: score[team] - 1 };
  return isPlausibleSetScore(next.a, next.b);
}

/** Minus on the active set, or on the set that just ended when the next one is still empty. */
export function canTakeGame(state: MatchState, team: TeamId): boolean {
  if (state.ended) return false;
  const active = state.sets[state.activeSet];
  if (canDecrement(active, team)) return true;
  if (state.activeSet === 0 || active[team] !== 0) return false;
  const previous = state.sets[state.activeSet - 1];
  return previous ? canDecrement(previous, team) : false;
}

export function isUpcomingSet(state: MatchState, index: SetIndex): boolean {
  if (index <= state.activeSet) return false;
  const set = state.sets[index];
  return set.a === 0 && set.b === 0;
}

export function displayGames(state: MatchState, index: SetIndex, team: TeamId): string {
  if (isUpcomingSet(state, index)) return '–';
  return String(state.sets[index][team]);
}

/**
 * Next or previous server in the game rotation.
 * The cycle is the one that puts `serve` on game `gamesPlayed` (the score before this step).
 * A manual choice that does not sit on that slot still stays in the cycle of the team
 * that would have started, and steps from the chosen player.
 *
 * Tiebreak points are not counted. A 6–6 set is one game in this rotation: the server
 * shown at 6–6 serves that whole game, and the server does not change every two points.
 * Scoring that game keeps the opposite team and asks which partner serves next.
 * Until a partner is chosen, each game won moves that team preselection to the other side.
 *
 * Minus walks this same cycle backwards. That restores the server of the game just
 * removed. It does not ask for a new server. Choosing another set leaves the server
 * as it is.
 */
export function rotateServe(serve: Server | null, gamesPlayedCount: number, direction: 1 | -1): Server | null {
  if (!serve) return null;
  const start = inferServeStart(gamesPlayedCount, serve) ?? (gamesPlayedCount % 2 === 0 ? serve.team : otherTeam(serve.team));
  const cycle = serveCycle(start);
  const found = cycle.findIndex((item) => item.team === serve.team && item.player === serve.player);
  const index = found >= 0 ? found : ((gamesPlayedCount % 4) + 4) % 4;
  return cycle[(index + direction + 4) % 4] ?? null;
}

/**
 * Tap on a team's ball. Another team jumps to player 1.
 * The same team goes player 1 → player 2 → unknown.
 */
export function serveChoice(current: Server | null, team: TeamId): Server | null {
  if (current?.team !== team) return { team, player: 1 };
  if (current.player === 1) return { team, player: 2 };
  return null;
}

export function serveLabel(serve: Server | null): string {
  if (!serve) return 'Serve open';
  return `Serve ${serve.team.toUpperCase()}${serve.player}`;
}

/** Spoken score line. After a tiebreak the team can be known before the partner is. */
export function serveCourtLabel(state: MatchState): string {
  if (state.serve) return serveLabel(state.serve);
  if (state.serveAsk) return `Team ${state.serveAsk.toUpperCase()} to serve`;
  return serveLabel(null);
}

/** The unscored game of the active set is a tiebreak when the set is 6:6. */
export function isTiebreak(state: MatchState): boolean {
  const set = state.sets[state.activeSet];
  return set.a === 6 && set.b === 6;
}

/**
 * At 6:6 the hint follows the FIP tie-break (one serve from the right, then two
 * each, the next two from the left, ends every 6 points). This counter still
 * scores that game as one game. It does not step the server every two points.
 * The English rule says those next two points are “serving from the left” and
 * does not name a side for each later point. Rule 6.5 still alternates sides.
 */
export function tiebreakCueText(state: MatchState): string {
  const who = state.serve
    ? `${state.teams[state.serve.team].name} player ${state.serve.player}`
    : 'The player whose turn it is';
  return `${who} serves first: 1 point from the right. Then the other team serves 2 points, from the left. After that, 2 points each. Change ends every 6 points.`;
}

/**
 * After 7–6 the next set is opened by the pair that did not start the tie-break
 * (tie-break point 5). Rule 6.8: before the set, that pair chooses which player serves.
 * The court already preselects that pair. A 6–4 or 7–5 finish has no such sentence.
 */
export function nextSetCueText(state: MatchState, team: TeamId): string {
  const name = state.teams[team].name;
  return `${name} serves first in this set, because they did not start the tie-break. They choose which player serves.`;
}

export type CourtCue =
  | { readonly kind: 'choose-serve'; readonly text: string }
  | { readonly kind: 'tiebreak'; readonly text: string }
  | { readonly kind: 'next-set'; readonly text: string };

/** A hint only while the court still needs it. A chosen server clears it. */
export function courtCue(state: MatchState): CourtCue | null {
  if (state.ended || matchWinner(state.sets)) return null;
  const active = state.sets[state.activeSet];
  if (active.a === 6 && active.b === 6) return { kind: 'tiebreak', text: tiebreakCueText(state) };
  if (active.a !== 0 || active.b !== 0 || state.serve !== null) return null;
  const previous = state.activeSet > 0 ? state.sets[state.activeSet - 1] : undefined;
  const afterTiebreak = previous !== undefined
    && ((previous.a === 7 && previous.b === 6) || (previous.a === 6 && previous.b === 7));
  if (afterTiebreak && state.serveAsk) return { kind: 'next-set', text: nextSetCueText(state, state.serveAsk) };
  const untouched = state.sets.every((set) => set.a === 0 && set.b === 0);
  if (untouched && state.serveAsk === null) return { kind: 'choose-serve', text: CHOOSE_SERVE_TEXT };
  return null;
}

export function tiebreakHint(state: MatchState): string | null {
  const cue = courtCue(state);
  return cue?.kind === 'tiebreak' ? cue.text : null;
}

/**
 * After a tiebreak the opposite team is already chosen, so the court asks only for the partner.
 * An older save that cleared the whole server still asks for a server.
 */
export function servePickPrompt(state: MatchState): string | null {
  if (state.ended || matchWinner(state.sets)) return null;
  if (state.serveAsk && state.serve === null) return 'Choose the player';
  if (!state.servePrompt || state.serve !== null) return null;
  return 'Choose the server';
}

export function serverMark(team: TeamId, player: PlayerSlot): string {
  return `${team.toUpperCase()}${player}`;
}
