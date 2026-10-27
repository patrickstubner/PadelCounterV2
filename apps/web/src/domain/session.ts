import { rememberMatch, snapshotMatch, type ArchivedMatch } from './archive';
import { appendEvent, omitMatch, replay, undoLog, type LogAction, type MatchLog } from './log';
import { isNewMatchEvent } from './types';

export interface Session {
  readonly log: MatchLog;
  readonly archive: readonly ArchivedMatch[];
}

export type SessionAction =
  | LogAction
  | { readonly type: 'delete-match'; readonly id: string }
  | { readonly type: 'replace'; readonly log: MatchLog };

export function sessionReducer(session: Session, action: SessionAction): Session {
  if (action.type === 'replace') {
    const current = replay(session.log);
    const snap = current.matchId === replay(action.log).matchId ? null : snapshotMatch(session.log);
    return {
      log: action.log,
      archive: snap ? rememberMatch(session.archive, snap) : session.archive,
    };
  }

  if (action.type === 'delete-match') {
    if (replay(session.log).matchId === action.id) return session;
    if (!session.archive.some((match) => match.id === action.id)) return session;
    return {
      log: omitMatch(session.log, action.id),
      archive: session.archive.filter((match) => match.id !== action.id),
    };
  }

  if (action.type === 'undo') {
    const last = session.log.events[session.log.events.length - 1];
    const log = undoLog(session.log);
    if (!last || !isNewMatchEvent(last)) return { log, archive: session.archive };
    const restored = replay(log).matchId;
    return { log, archive: session.archive.filter((match) => match.id !== restored) };
  }

  if (isNewMatchEvent(action.event)) {
    const snap = snapshotMatch(session.log);
    const log = appendEvent(session.log, action.event);
    if (log === session.log) return session;
    return { log, archive: snap ? rememberMatch(session.archive, snap) : session.archive };
  }

  const log = appendEvent(session.log, action.event);
  if (log === session.log) return session;
  return { log, archive: session.archive };
}
