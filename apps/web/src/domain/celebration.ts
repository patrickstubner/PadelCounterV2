import { isUuid } from './id';
import type { MatchLog } from './log';
import type { MatchStorage } from './persistence';
import { matchReducer } from './reducer';
import { celebrationWinner } from './rules';
import { isTimestamp } from './types';

/** Separate from the match log so a remembered celebration cannot fail log parsing. */
export const CELEBRATED_KEY = 'pcv2:celebrated';

const MAX_RAW_LENGTH = 200;

/**
 * The not-won to won transition that is on the court now.
 * `at` is the timestamp of the event that caused it, or the base `updatedAt`
 * when that event has already been folded into the base.
 */
export interface CelebratedWin {
  readonly matchId: string;
  readonly at: number;
}

interface Trail {
  readonly current: CelebratedWin | null;
  readonly beganOnLast: boolean;
}

/**
 * Walk the log once. The key is the winning event's own timestamp, so undo
 * (which deletes that event) and a later win do not share a key. Folding older
 * events into the base does not renumber a win that is still in the log.
 */
function trail(log: MatchLog): Trail {
  let state = log.base;
  let at: number | null = celebrationWinner(state) ? state.updatedAt : null;
  let beganOnLast = false;

  for (const event of log.events) {
    const next = matchReducer(state, event);
    const wasWon = celebrationWinner(state) !== null;
    const nowWon = celebrationWinner(next) !== null;
    if (next.matchId !== state.matchId) {
      at = nowWon ? event.at : null;
      beganOnLast = nowWon;
    } else if (!wasWon && nowWon) {
      at = event.at;
      beganOnLast = true;
    } else {
      beganOnLast = false;
      if (!nowWon) at = null;
    }
    state = next;
  }

  if (celebrationWinner(state) === null || at === null) {
    return { current: null, beganOnLast: false };
  }
  return {
    current: { matchId: state.matchId, at },
    beganOnLast,
  };
}

/** The win on the court now, or null when the match is not won. */
export function currentWin(log: MatchLog): CelebratedWin | null {
  return trail(log).current;
}

/**
 * True when the latest event is what made this match won.
 * A later game, rename, or End match on an already decided score is not that event.
 */
export function winBeganOnLastEvent(log: MatchLog): boolean {
  return trail(log).beganOnLast;
}

/** Same string for the stored win and the in-memory dismissal. */
export function celebrationKey(win: CelebratedWin): string {
  return `${win.matchId}:${win.at}`;
}

/**
 * Show the celebration only on the not-won to won edge, and only if this
 * win's key was not already celebrated (including after a reload).
 */
export function shouldCelebrate(log: MatchLog, saved: CelebratedWin | null): boolean {
  const win = currentWin(log);
  if (!win || !winBeganOnLastEvent(log)) return false;
  if (saved && celebrationKey(saved) === celebrationKey(win)) return false;
  return true;
}

/**
 * First launch after 1.2.8 has no stored key. Remember an already won match
 * without treating that load as a new win.
 */
export function acknowledgeCelebrated(
  log: MatchLog,
  storage: Pick<MatchStorage, 'getItem' | 'setItem'>,
): CelebratedWin | null {
  const existing = loadCelebrated(storage);
  if (existing) return existing;
  const win = currentWin(log);
  if (!win) return null;
  saveCelebrated(win, storage);
  return win;
}

function parseCelebrated(value: unknown): CelebratedWin | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(source)) copy[key] = source[key];
  const matchId = copy.matchId;
  const at = copy.at;
  if (!isUuid(matchId) || !isTimestamp(at)) return null;
  return { matchId: matchId.toLowerCase(), at };
}

export function loadCelebrated(storage: Pick<MatchStorage, 'getItem'>): CelebratedWin | null {
  try {
    const raw = storage.getItem(CELEBRATED_KEY);
    if (raw === null || raw.length === 0 || raw.length > MAX_RAW_LENGTH) return null;
    return parseCelebrated(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Drop a remembered win when that match is deleted. The live match is left alone. */
export function forgetCelebratedMatch(
  matchId: string,
  storage: Pick<MatchStorage, 'getItem'> & { removeItem(key: string): void },
): void {
  const saved = loadCelebrated(storage);
  if (saved?.matchId !== matchId) return;
  try {
    storage.removeItem(CELEBRATED_KEY);
  } catch {
    // Storage may be blocked. The match list still updates.
  }
}

export function saveCelebrated(win: CelebratedWin, storage: Pick<MatchStorage, 'setItem'>): boolean {
  try {
    const raw = JSON.stringify({ matchId: win.matchId, at: win.at });
    if (raw.length > MAX_RAW_LENGTH) return false;
    storage.setItem(CELEBRATED_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
