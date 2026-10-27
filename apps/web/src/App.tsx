import { useEffect, useMemo, useRef, useState } from 'react';
import { connectHistoryState, detailHistoryState, matchesHistoryState, privacyHistoryState, screenFromHistory, type ArchiveScreen } from './archiveNav';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ConnectPage } from './components/ConnectPage';
import { CourtHeader, type CourtAction } from './components/CourtHeader';
import { HistoryPage } from './components/HistoryPage';
import { PrivacyPage } from './components/PrivacyPage';
import { TeamPanel } from './components/TeamPanel';
import { UpdateReady } from './components/UpdateReady';
import { Victory } from './components/Victory';
import { listMatches } from './domain/archive';
import {
  acknowledgeCelebrated,
  celebrationKey,
  currentWin,
  saveCelebrated,
  winBeganOnLastEvent,
  type CelebratedWin,
} from './domain/celebration';
import { colonSetScore, currentHistory } from './domain/history';
import { RULES_SUMMARY, celebrationWinner, matchWinner, serveCourtLabel, servePickPrompt, tiebreakHint } from './domain/rules';
import { useInstallOffer } from './hooks/useInstallOffer';
import { useMatch } from './hooks/useMatch';
import { JOIN_KEY } from './live/protocol';
import { useLive } from './live/useLive';
import { INSTALL_LABEL, IOS_INSTALL_HINT } from './installOffer';
import { watchControllerChange } from './registerServiceWorker';
import { useWakeLock } from './useWakeLock';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function useUpdateReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    return watchControllerChange(navigator.serviceWorker, () => setReady(true));
  }, []);
  return ready;
}

export function App() {
  const match = useMatch();
  const room = useLive(match.liveRef, match.replaceLog);
  const install = useInstallOffer();
  useWakeLock();
  const updateReady = useUpdateReady();
  const updateButton = updateReady ? <UpdateReady onReload={() => window.location.reload()} /> : null;
  const [confirming, setConfirming] = useState<'reset' | 'end' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [screen, setScreen] = useState<ArchiveScreen>(() => {
    if (typeof history !== 'undefined') {
      const fromHistory = screenFromHistory(history.state);
      if (fromHistory.view !== 'court') return fromHistory;
    }
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(JOIN_KEY)) return { view: 'connect' };
    } catch {
      // Storage may be blocked. The court still opens.
    }
    return { view: 'court' };
  });
  const joinStarted = useRef(false);
  useEffect(() => {
    if (joinStarted.current) return;
    joinStarted.current = true;
    try {
      const raw = sessionStorage.getItem(JOIN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { matchId?: unknown; token?: unknown };
      if (typeof parsed.matchId !== 'string' || typeof parsed.token !== 'string') return;
      room.connect(parsed.matchId, parsed.token);
    } catch {
      // A bad saved code is ignored. The connect screen explains the failure if the socket opens.
    }
  }, [room]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = (event: PopStateEvent) => setScreen(screenFromHistory(event.state));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const matches = listMatches(match.log, match.archive);
  const selected = screen.view === 'detail' ? (matches.find((item) => item.id === screen.id) ?? null) : null;
  const openScreen = (next: ArchiveScreen, state: unknown) => {
    if (typeof history === 'undefined') {
      setScreen(next);
      return;
    }
    history.pushState(state, '');
    setScreen(next);
  };
  const openMatches = () => {
    if (typeof history === 'undefined') {
      setScreen({ view: 'matches' });
      return;
    }
    history.pushState(matchesHistoryState(), '');
    setScreen({ view: 'matches' });
  };
  const openDetail = (id: string) => {
    if (typeof history === 'undefined') {
      setScreen({ view: 'detail', id });
      return;
    }
    history.pushState(detailHistoryState(id), '');
    setScreen({ view: 'detail', id });
  };
  const openPrivacy = () => openScreen({ view: 'privacy' }, privacyHistoryState());
  const openConnect = () => openScreen({ view: 'connect' }, connectHistoryState());
  const closeArchive = () => {
    setDeletingId(null);
    if (typeof history === 'undefined') {
      setScreen((current) => (current.view === 'detail' ? { view: 'matches' } : { view: 'court' }));
      return;
    }
    history.back();
  };
  const askDelete = (id: string) => {
    if (id === match.state.matchId) return;
    setDeletingId(id);
  };
  const confirmDelete = () => {
    if (!deletingId || deletingId === match.state.matchId) {
      setDeletingId(null);
      return;
    }
    match.deleteMatch(deletingId);
    if (screen.view === 'detail' && screen.id === deletingId) {
      setScreen({ view: 'matches' });
      if (typeof history !== 'undefined') history.replaceState(matchesHistoryState(), '');
    }
    setDeletingId(null);
  };
  const { state } = match;
  const winner = matchWinner(state.sets);
  const celebrated = celebrationWinner(state);
  const reducedMotion = useReducedMotion();
  const [remembered, setRemembered] = useState<CelebratedWin | null>(() => {
    try {
      if (typeof localStorage === 'undefined') return null;
      return acknowledgeCelebrated(match.log, localStorage);
    } catch {
      return null;
    }
  });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const win = useMemo(() => currentWin(match.log), [match.log]);
  const victoryKey = win ? celebrationKey(win) : null;
  const rememberedKey = remembered ? celebrationKey(remembered) : null;
  const fresh =
    victoryKey !== null &&
    winBeganOnLastEvent(match.log) &&
    dismissed !== victoryKey &&
    rememberedKey !== victoryKey;
  const showVictory = victoryKey !== null && dismissed !== victoryKey && (opened === victoryKey || fresh);
  useEffect(() => {
    if (!fresh || !win || victoryKey === null) return;
    try {
      if (saveCelebrated(win, localStorage)) setRemembered(win);
    } catch {
      // Storage may be blocked. Dismissal still closes this showing.
    }
    setOpened(victoryKey);
  }, [fresh, victoryKey, win]);
  const active = state.sets[state.activeSet];
  const tiebreak = tiebreakHint(state);
  const pick = servePickPrompt(state);
  const scoreLine = `${state.teams.a.name} ${active.a}, ${state.teams.b.name} ${active.b}`;
  const serve = serveCourtLabel(state);
  const showFinal = state.ended || winner !== null;
  const finalSets = state.sets.map((set, index) => `Set ${index + 1} ${set.a}–${set.b}`).join(', ');
  const live = showVictory && celebrated
    ? `${state.teams[celebrated].name} wins!`
    : showFinal && celebrated
      ? `Final score. ${state.teams[celebrated].name} wins. ${finalSets}.`
      : showFinal
        ? `Match ended. Final score. ${finalSets}.`
        : `Set ${state.activeSet + 1}. ${scoreLine}. ${serve}.${pick ? ` ${pick}.` : ''}${tiebreak ? ` ${tiebreak}.` : ''}`;
  const historyRows = currentHistory(match.log);
  const played = matches.filter((item) => !item.live);

  if (screen.view === 'privacy') {
    return (
      <div className="app">
        <PrivacyPage onBack={closeArchive} />
        <p className="app-version" data-testid="app-version">{`v${import.meta.env.APP_VERSION}`}</p>
        {updateButton}
      </div>
    );
  }

  if (screen.view === 'connect') {
    return (
      <div className="app">
        <ConnectPage
          configured={room.configured}
          status={room.status}
          players={room.players}
          qr={room.qr}
          error={room.error}
          onShare={() => room.share(match.log)}
          onRotate={room.rotate}
          onLeave={() => {
            room.disconnect();
            try {
              sessionStorage.removeItem(JOIN_KEY);
            } catch {
              // Storage may be blocked.
            }
          }}
          onBack={closeArchive}
        />
        <p className="app-version" data-testid="app-version">{`v${import.meta.env.APP_VERSION}`}</p>
        {updateButton}
      </div>
    );
  }

  if (screen.view !== 'court') {
    return (
      <div className="app">
        <HistoryPage
          mode={screen.view === 'detail' ? 'detail' : 'list'}
          live={{
            nameA: state.teams.a.name,
            nameB: state.teams.b.name,
            gameA: active.a,
            gameB: active.b,
            setsLabel: colonSetScore(state.sets),
            detail: showFinal ? 'Final' : `Set ${state.activeSet + 1}`,
          }}
          rows={historyRows}
          played={played}
          selected={selected}
          onOpen={openDetail}
          onBack={closeArchive}
          onAskDelete={askDelete}
        />
        {deletingId ? (
          <ConfirmDialog
            titleId="delete-match-title"
            title="Delete this match?"
            body="The match is removed from History on this device."
            confirmLabel="Delete"
            confirmTestId="confirm-delete"
            cancelTestId="cancel-delete"
            onCancel={() => setDeletingId(null)}
            onConfirm={confirmDelete}
          />
        ) : null}
        <p className="app-version" data-testid="app-version">{`v${import.meta.env.APP_VERSION}`}</p>
        {updateButton}
      </div>
    );
  }

  const actions: readonly CourtAction[] = [
    { id: 'connect', label: 'Connect players', testId: 'connect-open', onSelect: openConnect },
    { id: 'history', label: 'History', testId: 'history-open', onSelect: openMatches },
    state.ended
      ? { id: 'resume', label: 'Resume', testId: 'resume-match', emphasized: true, onSelect: match.resumeMatch }
      : { id: 'end', label: 'End match', testId: 'end-match', onSelect: () => setConfirming('end') },
    { id: 'reset', label: 'New match', testId: 'new-match', onSelect: () => setConfirming('reset') },
    { id: 'privacy', label: 'Privacy', testId: 'privacy-open', onSelect: openPrivacy },
    ...(install.kind === 'prompt'
      ? [{
          id: 'install',
          label: INSTALL_LABEL,
          testId: 'add-to-home-screen',
          menuOnly: true,
          onSelect: () => { void install.prompt(); },
        }]
      : install.kind === 'ios'
        ? [{
            id: 'install',
            label: INSTALL_LABEL,
            testId: 'add-to-home-screen',
            menuOnly: true,
            textOnly: true,
            detail: IOS_INSTALL_HINT,
            onSelect: () => undefined,
          }]
        : []),
  ];

  return (
    <div className="app">
      <CourtHeader setLabel={`Set ${state.activeSet + 1}`} onBrand={openMatches} actions={actions} />
      {showVictory && screen.view === 'court' && celebrated ? (
        <Victory
          name={state.teams[celebrated].name}
          team={celebrated}
          reducedMotion={reducedMotion}
          onClose={() => setDismissed(victoryKey)}
        />
      ) : null}
      <main className="board">
        <TeamPanel
          team="a"
          state={state}
          onIncrement={match.increment}
          onDecrement={match.decrement}
          onRename={match.rename}
          onSelectSet={match.selectSet}
          onServe={match.chooseServe}
        />
        <div className="mid">
          {state.ended ? (
            <span className="chip chip-ended" data-testid="match-status">
              Ended
            </span>
          ) : winner ? (
            <span className={`chip chip-${winner}`}>Win · {state.teams[winner].name}</span>
          ) : null}
          {showFinal ? (
            <p className="end-note" data-testid="final-score">
              Final score
            </p>
          ) : null}
          {tiebreak ? (
            <p className="tb" data-testid="tiebreak-hint">
              {tiebreak}
            </p>
          ) : null}
          {pick ? (
            <p className="serve-prompt" data-testid="serve-prompt">
              {pick}
            </p>
          ) : null}
        </div>
        <TeamPanel
          team="b"
          state={state}
          onIncrement={match.increment}
          onDecrement={match.decrement}
          onRename={match.rename}
          onSelectSet={match.selectSet}
          onServe={match.chooseServe}
        />
      </main>
      <footer className="foot">
        {match.saveFailed ? <p className="save-note">Saving on this device failed.</p> : null}
        <p className="rules">{RULES_SUMMARY}</p>
        <p className="app-version" data-testid="app-version">{`v${import.meta.env.APP_VERSION}`}</p>
        {updateButton}
      </footer>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      {confirming === 'reset' ? (
        <ConfirmDialog
          titleId="new-match-title"
          title="New match?"
          body="The score is reset. Team names go back to Team A and Team B."
          confirmLabel="Reset"
          confirmTestId="confirm-reset"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            room.disconnect();
            match.newMatch();
            setConfirming(null);
          }}
        />
      ) : null}
      {confirming === 'end' ? (
        <ConfirmDialog
          titleId="end-match-title"
          title="End match?"
          body="The final score stays. Plus, minus, sets, serve and names stay locked until the match resumes."
          confirmLabel="End"
          confirmTestId="confirm-end"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            match.endMatch();
            setConfirming(null);
          }}
        />
      ) : null}
    </div>
  );
}
