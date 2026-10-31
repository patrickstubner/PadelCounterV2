import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { isScoreEvent, scoreClaimFor, type ScoreClaim } from '@padel/core';
import { loadArchive, saveArchive } from '../domain/archive';
import { forgetCelebratedMatch } from '../domain/celebration';
import { createMatchId } from '../domain/id';
import { appendEvent, createLog, replay, type MatchLog } from '../domain/log';
import { loadLog, saveLog } from '../domain/persistence';
import { serveChoice } from '../domain/rules';
import { sessionReducer, type Session } from '../domain/session';
import type { MatchEvent, SetIndex, TeamId } from '../domain/types';

/** Return true when the live server accepted the event and the local log must wait for it. */
export type LiveSend = (event: MatchEvent, claim: ScoreClaim | null) => boolean;

function initialSession(): Session {
  try {
    return {
      log: loadLog(localStorage) ?? createLog(Date.now(), createMatchId()),
      archive: loadArchive(localStorage),
    };
  } catch {
    return { log: createLog(Date.now(), createMatchId()), archive: [] };
  }
}

export function useMatch() {
  const [session, dispatch] = useReducer(sessionReducer, undefined, initialSession);
  const [saveFailed, setSaveFailed] = useState(false);
  const liveRef = useRef<LiveSend | null>(null);
  const logRef = useRef(session.log);
  logRef.current = session.log;
  const { log } = session;
  const state = useMemo(() => replay(log), [log]);

  useEffect(() => {
    try {
      const logSaved = saveLog(log, localStorage);
      const archiveSaved = saveArchive(session.archive, localStorage);
      setSaveFailed(!logSaved || !archiveSaved);
    } catch {
      setSaveFailed(true);
    }
  }, [log, session.archive]);

  const at = () => Date.now();
  const record = (event: MatchEvent) => dispatch({ type: 'record', event });
  const publish = (event: MatchEvent) => {
    const current = replay(logRef.current);
    const claim = isScoreEvent(event.type) ? scoreClaimFor(current, event) : null;
    if (isScoreEvent(event.type) && !claim) return;
    if (liveRef.current?.(event, claim)) return;
    logRef.current = appendEvent(logRef.current, event);
    record(event);
  };

  return {
    state,
    log,
    liveRef,
    archive: session.archive,
    events: log.events,
    saveFailed,
    reapply: (event: MatchEvent) => publish({ ...event, at: at() }),
    increment: (team: TeamId) => publish({ type: 'game/increment', team, at: at() }),
    decrement: (team: TeamId) => publish({ type: 'game/decrement', team, at: at() }),
    rename: (team: TeamId, name: string) => publish({ type: 'team/rename', team, name, at: at() }),
    selectSet: (index: SetIndex) => publish({ type: 'set/select', index, at: at() }),
    newMatch: () => record({ type: 'match/new', matchId: createMatchId(), at: at() }),
    recordAll: (events: readonly MatchEvent[]) => dispatch({ type: 'record-all', events }),
    endMatch: () => publish({ type: 'match/end', at: at() }),
    resumeMatch: () => publish({ type: 'match/resume', at: at() }),
    chooseServe: (team: TeamId) => {
      const next = serveChoice(state.serve, team);
      publish({
        type: 'serve/set',
        team: next?.team ?? null,
        player: next?.player ?? null,
        at: at(),
      });
    },
    readLog: () => logRef.current,
    replaceLog: (next: MatchLog) => {
      logRef.current = next;
      dispatch({ type: 'replace', log: next });
    },
    archiveLocal: (kept: MatchLog) => {
      dispatch({ type: 'archive-log', log: kept });
    },
    continueMatch: (next: MatchLog) => {
      logRef.current = next;
      dispatch({ type: 'continue-match', log: next });
    },
    applyLive: (event: MatchEvent) => {
      logRef.current = appendEvent(logRef.current, event);
      dispatch({ type: 'record', event });
    },
    revertLive: (event: MatchEvent) => {
      logRef.current = sessionReducer({ log: logRef.current, archive: session.archive }, { type: 'revert', event }).log;
      dispatch({ type: 'revert', event });
    },
    deleteMatch: (id: string) => {
      if (state.matchId === id) return;
      if (!session.archive.some((match) => match.id === id)) return;
      try {
        forgetCelebratedMatch(id, localStorage);
      } catch {
        // Storage may be blocked. The list still drops the match.
      }
      dispatch({ type: 'delete-match', id });
    },
  };
}
