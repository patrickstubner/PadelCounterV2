import { createMatchId, isUuid } from './id';
import type { MatchLog } from './parse';
import { clampLiveTeamName, sanitizeTeamName, storedTeamName } from './names';
import { canDecrement, gamesPlayed, isPlausibleSetScore, matchWinner, rotateServe, setWinner } from './rules';
import { SCHEMA_VERSION, isNewMatchEvent, isPlayerSlot, isSetIndex, isTeamId, isTimestamp, type MatchEvent, type MatchState, type Server, type SetIndex, type SetScore, type TeamId } from './types';

/** Names stored for a new live match. Replay cannot put a stack of marks back. */
export function prepareLiveLog(log: MatchLog): MatchLog {
  const events = log.events.map((event) => {
    if (event.type !== 'team/rename') return event;
    const name = clampLiveTeamName(event.name, event.team);
    return name === event.name ? event : { ...event, name };
  });
  const nameA = clampLiveTeamName(log.base.teams.a.name, 'a');
  const nameB = clampLiveTeamName(log.base.teams.b.name, 'b');
  const base = nameA === log.base.teams.a.name && nameB === log.base.teams.b.name
    ? log.base
    : {
        ...log.base,
        teams: {
          a: { name: nameA },
          b: { name: nameB },
        },
      };
  return { ...log, base, events };
}

export function createMatch(
  at: number,
  matchId: string = createMatchId(),
  names?: { readonly a?: string; readonly b?: string },
): MatchState {
  return {
    schemaVersion: SCHEMA_VERSION,
    matchId,
    revision: 0,
    createdAt: at,
    updatedAt: at,
    teams: {
      a: { name: sanitizeTeamName(names?.a ?? '', 'a') },
      b: { name: sanitizeTeamName(names?.b ?? '', 'b') },
    },
    sets: [
      { a: 0, b: 0 },
      { a: 0, b: 0 },
      { a: 0, b: 0 },
    ],
    activeSet: 0,
    serve: null,
    serveAsk: null,
    servePrompt: false,
    ended: false,
  };
}

function stamp(
  state: MatchState,
  at: number,
  patch: Pick<MatchState, 'sets' | 'activeSet' | 'teams'> & {
    readonly serve?: Server | null;
    readonly serveAsk?: TeamId | null;
    readonly servePrompt?: boolean;
    readonly ended?: boolean;
  },
): MatchState {
  return {
    ...state,
    ...patch,
    serve: patch.serve === undefined ? state.serve : patch.serve,
    serveAsk: patch.serveAsk === undefined ? state.serveAsk : patch.serveAsk,
    servePrompt: patch.servePrompt === undefined ? state.servePrompt : patch.servePrompt,
    ended: patch.ended === undefined ? state.ended : patch.ended,
    revision: state.revision + 1,
    updatedAt: Math.max(state.updatedAt, at),
  };
}

function replaceSet(state: MatchState, index: SetIndex, score: SetScore): MatchState['sets'] {
  const sets: [SetScore, SetScore, SetScore] = [
    state.sets[0],
    state.sets[1],
    state.sets[2],
  ];
  sets[index] = score;
  return sets;
}

function nextSetIndex(index: SetIndex): SetIndex {
  if (index === 0) return 1;
  return 2;
}

function applyGame(state: MatchState, team: TeamId, at: number, delta: 1 | -1): MatchState {
  let index: SetIndex = state.activeSet;
  if (delta === -1 && state.sets[index][team] <= 0 && index > 0) {
    const previous = (index - 1) as SetIndex;
    const earlier = state.sets[previous];
    if (earlier && canDecrement(earlier, team)) index = previous;
  }
  const current = state.sets[index];
  const nextScore: SetScore = {
    a: team === 'a' ? current.a + delta : current.a,
    b: team === 'b' ? current.b + delta : current.b,
  };
  if (!isPlausibleSetScore(nextScore.a, nextScore.b)) return state;

  const wasWon = setWinner(current.a, current.b) !== null;
  const sets = replaceSet(state, index, nextScore);
  let activeSet: SetIndex = index;
  const nowWon = setWinner(nextScore.a, nextScore.b) !== null;
  if (delta === 1 && !wasWon && nowWon && index < 2 && matchWinner(sets) === null) {
    const later = index === 0 ? [sets[1], sets[2]] : [sets[2]];
    const restEmpty = later.every((set) => set.a === 0 && set.b === 0);
    if (restEmpty) activeSet = nextSetIndex(index);
  }

  const starter = state.serve;
  const tiebreakGame = delta === 1 && current.a === 6 && current.b === 6 && starter !== null;
  return stamp(state, at, {
    sets,
    activeSet,
    teams: state.teams,
    serve: tiebreakGame ? null : rotateServe(starter, gamesPlayed(state.sets), delta),
    serveAsk: serveAskAfterGame(state, starter, tiebreakGame, delta),
    servePrompt: tiebreakGame ? false : state.servePrompt,
  });
}

/**
 * A tiebreak with a known server preselects the other team.
 * While that choice is still only a team, every game won moves the preselection
 * to the other team. Who won the game does not matter.
 * This one step clears that preselection. Replaying a Minus of the latest game
 * puts the server and the preselection back to the moment before that game.
 */
function serveAskAfterGame(
  state: MatchState,
  starter: Server | null,
  tiebreakGame: boolean,
  delta: 1 | -1,
): TeamId | null {
  if (tiebreakGame && starter) return starter.team === 'a' ? 'b' : 'a';
  if (delta === -1) return null;
  if (starter === null && state.serveAsk) return state.serveAsk === 'a' ? 'b' : 'a';
  return state.serveAsk;
}

export function matchReducer(state: MatchState, event: MatchEvent): MatchState {
  if (!isTimestamp(event.at)) return state;
  if (state.ended && event.type !== 'match/resume' && !isNewMatchEvent(event)) return state;

  switch (event.type) {
    case 'game/increment':
      if (!isTeamId(event.team)) return state;
      return applyGame(state, event.team, event.at, 1);
    case 'game/decrement':
      if (!isTeamId(event.team)) return state;
      return applyGame(state, event.team, event.at, -1);
    case 'set/select':
      if (!isSetIndex(event.index) || event.index === state.activeSet) return state;
      return stamp(state, event.at, {
        sets: state.sets,
        activeSet: event.index,
        teams: state.teams,
      });
    case 'team/rename': {
      if (!isTeamId(event.team) || typeof event.name !== 'string') return state;
      const name = storedTeamName(event.name, event.team);
      if (name === state.teams[event.team].name) return state;
      const teams =
        event.team === 'a'
          ? { a: { name }, b: state.teams.b }
          : { a: state.teams.a, b: { name } };
      return stamp(state, event.at, { sets: state.sets, activeSet: state.activeSet, teams });
    }
    case 'match/reset':
    case 'match/new': {
      if (!isUuid(event.matchId)) return state;
      const names = event.type === 'match/reset'
        ? { a: state.teams.a.name, b: state.teams.b.name }
        : undefined;
      return createMatch(event.at, event.matchId.toLowerCase(), names);
    }
    case 'match/end':
      return stamp(state, event.at, {
        sets: state.sets,
        activeSet: state.activeSet,
        teams: state.teams,
        ended: true,
      });
    case 'match/resume':
      if (!state.ended) return state;
      return stamp(state, event.at, {
        sets: state.sets,
        activeSet: state.activeSet,
        teams: state.teams,
        ended: false,
      });
    case 'serve/set': {
      if (event.team === null || event.player === null) {
        if (event.team !== null || event.player !== null) return state;
        if (state.serve === null && !state.servePrompt && !state.serveAsk) return state;
        return stamp(state, event.at, {
          sets: state.sets,
          activeSet: state.activeSet,
          teams: state.teams,
          serve: null,
          serveAsk: null,
          servePrompt: false,
        });
      }
      if (!isTeamId(event.team) || !isPlayerSlot(event.player)) return state;
      if (state.serveAsk && state.serve === null && event.team !== state.serveAsk) return state;
      if (state.serve?.team === event.team && state.serve.player === event.player && !state.servePrompt && !state.serveAsk) return state;
      return stamp(state, event.at, {
        sets: state.sets,
        activeSet: state.activeSet,
        teams: state.teams,
        serve: { team: event.team, player: event.player },
        serveAsk: null,
        servePrompt: false,
      });
    }
    default:
      return state;
  }
}

interface OpenGame {
  readonly set: 0 | 1 | 2;
  readonly team: TeamId;
  readonly serve: Server | null;
  readonly serveAsk: TeamId | null;
  readonly servePrompt: boolean;
}

/** The one set whose games changed. A no-op, or a step that touches none, is null. */
function scoredSet(before: MatchState, after: MatchState): 0 | 1 | 2 | null {
  for (let index = 0; index < 3; index += 1) {
    const left = before.sets[index];
    const right = after.sets[index];
    if (!left || !right) return null;
    if (left.a !== right.a || left.b !== right.b) {
      if (index === 1) return 1;
      if (index === 2) return 2;
      return 0;
    }
  }
  return null;
}

/**
 * Replay stays lenient: an event the court ignores leaves the score as it was.
 * Minus of the latest open game puts the server, the choosing team, and a
 * pending choice back to the moment before that game, including across a set.
 * Minus of an older game keeps the single step, so later games stay in rotation.
 * A minus whose game is not in this log keeps the single step as well.
 */
export function replayScore(base: MatchState, events: readonly MatchEvent[]): MatchState {
  const open: OpenGame[] = [];
  let state = base;
  for (const event of events) {
    const next = matchReducer(state, event);
    if (next === state) continue;
    if (isNewMatchEvent(event)) {
      open.length = 0;
      state = next;
      continue;
    }
    if (event.type === 'game/increment' && isTeamId(event.team)) {
      const set = scoredSet(state, next);
      if (set !== null) {
        open.push({
          set,
          team: event.team,
          serve: state.serve,
          serveAsk: state.serveAsk,
          servePrompt: state.servePrompt,
        });
      }
      state = next;
      continue;
    }
    if (event.type === 'game/decrement' && isTeamId(event.team)) {
      const set = scoredSet(state, next);
      let restored = next;
      if (set !== null) {
        let matched = -1;
        for (let index = open.length - 1; index >= 0; index -= 1) {
          const prior = open[index];
          if (!prior || prior.set !== set || prior.team !== event.team) continue;
          matched = index;
          break;
        }
        if (matched >= 0) {
          const prior = open[matched];
          const latest = matched === open.length - 1;
          open.splice(matched, 1);
          if (latest && prior) {
            restored = {
              ...next,
              serve: prior.serve,
              serveAsk: prior.serveAsk,
              servePrompt: prior.servePrompt,
            };
          }
        }
      }
      state = restored;
      continue;
    }
    state = next;
  }
  return state;
}

/** The worker picks the id. The client id is not a capability and is not kept. */
export function assignMatchId(log: MatchLog, matchId: string): MatchLog | null {
  if (!isUuid(matchId)) return null;
  const nextId = matchId.toLowerCase();
  const current = replayScore(log.base, log.events).matchId;
  const rewrite = (id: string) => (id === current ? nextId : id);
  return {
    schemaVersion: log.schemaVersion,
    base: { ...log.base, matchId: rewrite(log.base.matchId) },
    events: log.events.map((event) =>
      isNewMatchEvent(event) ? { ...event, matchId: rewrite(event.matchId) } : event,
    ),
  };
}
