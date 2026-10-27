import { createMatchId, isUuid } from './id';
import { sanitizeTeamName } from './names';
import { gamesPlayed, isPlausibleSetScore, matchWinner, rotateServe, setWinner } from './rules';
import { SCHEMA_VERSION, isNewMatchEvent, isPlayerSlot, isSetIndex, isTeamId, isTimestamp, type MatchEvent, type MatchState, type Server, type SetIndex, type SetScore, type TeamId } from './types';

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
  const index = state.activeSet;
  const current = state.sets[index];
  const nextScore: SetScore = {
    a: team === 'a' ? current.a + delta : current.a,
    b: team === 'b' ? current.b + delta : current.b,
  };
  if (!isPlausibleSetScore(nextScore.a, nextScore.b)) return state;

  const wasWon = setWinner(current.a, current.b) !== null;
  const sets = replaceSet(state, index, nextScore);
  let activeSet = index;
  const nowWon = setWinner(nextScore.a, nextScore.b) !== null;
  if (!wasWon && nowWon && index < 2 && matchWinner(sets) === null) {
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
 * to the other team. Who won the game does not matter. Minus clears it.
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
      const name = sanitizeTeamName(event.name, event.team);
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

export function replayScore(base: MatchState, events: readonly MatchEvent[]): MatchState {
  return events.reduce(matchReducer, base);
}
