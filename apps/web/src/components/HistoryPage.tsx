import { useEffect, useRef } from 'react';
import { formatEventTime, formatMatchStamp } from '../domain/log';
import { archivedHistory, type HistoryRow } from '../domain/history';
import { winnerTeam, type ListedMatch } from '../domain/archive';

interface LiveScore {
  readonly nameA: string;
  readonly nameB: string;
  readonly gameA: number;
  readonly gameB: number;
  readonly setsLabel: string;
  readonly detail: string;
}

interface HistoryPageProps {
  mode: 'list' | 'detail';
  live: LiveScore;
  rows: readonly HistoryRow[];
  played: readonly ListedMatch[];
  selected: ListedMatch | null;
  onOpen: (id: string) => void;
  onBack: () => void;
  onAskDelete: (id: string) => void;
  onContinue?: () => void;
}

function EventList({ rows, testId }: { rows: readonly HistoryRow[]; testId: string }) {
  if (rows.length === 0) {
    return (
      <p className="history-empty" data-testid={testId}>
        No games yet.
      </p>
    );
  }
  return (
    <ol className="history-events" data-testid={testId}>
      {rows.map((row, index) => (
        <li key={`${row.at}-${index}`} className="history-row">
          <time dateTime={new Date(row.at).toISOString()}>{formatEventTime(row.at)}</time>
          <span className="history-label">
            {row.label}
            {row.who ? <span className="history-who">{` · ${row.who}`}</span> : null}
          </span>
          <span className="history-score" data-testid="history-score">
            {row.score.map((set, setIndex) => (
              <span key={setIndex}>
                {setIndex > 0 ? ' ' : null}
                {set.aChanged ? <mark className="history-changed">{set.a}</mark> : <span>{set.a}</span>}
                :
                {set.bChanged ? <mark className="history-changed">{set.b}</mark> : <span>{set.b}</span>}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function HistoryPage({ mode, live, rows, played, selected, onOpen, onBack, onAskDelete, onContinue }: HistoryPageProps) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, [mode, selected?.id]);

  const detailRows = selected ? archivedHistory(selected.id, selected.at, selected.nameA, selected.nameB, selected.events) : [];
  const title = mode === 'detail' ? (selected ? `${selected.nameA} · ${selected.nameB}` : 'Match') : 'History';

  return (
    <section className="history-page" data-testid="history-page" aria-label={title}>
      <div className="history-bar">
        <button type="button" className="history-back" data-testid="history-back" ref={backRef} onClick={onBack}>
          {mode === 'detail' ? 'Back' : 'Match'}
        </button>
        <h1 className="history-title">{title}</h1>
      </div>
      {mode === 'detail' ? (
        selected ? (
          <div className="history-scroll" data-testid="match-detail">
            <CompactPast match={selected} />
            {onContinue ? (
              <button type="button" className="history-continue" data-testid="continue-match" onClick={onContinue}>
                Continue
              </button>
            ) : null}
            <EventList rows={detailRows} testId="history-events" />
          </div>
        ) : (
          <p className="history-empty" data-testid="match-missing">
            Match not found.
          </p>
        )
      ) : (
        <div className="history-scroll">
          <CompactLive live={live} />
          <h2 className="history-section">This match</h2>
          <EventList rows={rows} testId="history-events" />
          <h2 className="history-section">Played matches</h2>
          {played.length > 0 ? (
            <ol className="history-played" data-testid="played-list">
              {played.map((match) => {
                const winner = winnerTeam(match.statusKind);
                return (
                  <li key={match.id} className="history-played-item">
                    <button type="button" className="history-match" data-testid="match-row" onClick={() => onOpen(match.id)}>
                      <time dateTime={new Date(match.at).toISOString()}>{formatMatchStamp(match.at)}</time>
                      <span className="history-match-names">{`${match.nameA} · ${match.nameB}`}</span>
                      <span className="history-match-score">{match.score}</span>
                      <span className={winner ? `history-match-status is-${winner}` : 'history-match-status'}>{match.status}</span>
                    </button>
                    {match.live ? null : (
                      <button
                        type="button"
                        className="history-delete"
                        data-testid="delete-match"
                        data-match-id={match.id}
                        aria-label={`Delete match ${match.nameA} versus ${match.nameB}`}
                        onClick={() => onAskDelete(match.id)}
                      >
                        Delete
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="history-empty">No other matches.</p>
          )}
        </div>
      )}
    </section>
  );
}

function CompactLive({ live }: { live: LiveScore }) {
  return (
    <div className="history-current" data-testid="history-current">
      <span className="history-team is-a">{live.nameA}</span>
      <span className="history-now">{`${live.gameA}:${live.gameB}`}</span>
      <span className="history-team is-b">{live.nameB}</span>
      <p className="history-meta">{`${live.setsLabel} · ${live.detail}`}</p>
    </div>
  );
}

function CompactPast({ match }: { match: ListedMatch }) {
  return (
    <div className="history-current" data-testid="history-current">
      <span className="history-team is-a">{match.nameA}</span>
      <span className="history-now history-now-sets">{match.score}</span>
      <span className="history-team is-b">{match.nameB}</span>
      <p className="history-meta">{match.status}</p>
    </div>
  );
}
