import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isOpenMatch, lastChangeAt, otherPhones, planNewMatch, scoreClaimFor, type NewMatchPlan } from '@padel/core';
import { detailHistoryState, joinHistoryState, matchesHistoryState, privacyHistoryState, screenFromHistory, type ArchiveScreen } from './archiveNav';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ConnectPage } from './components/ConnectPage';
import { JoinMatchPage } from './components/JoinMatchPage';
import { CourtHeader, type CourtAction } from './components/CourtHeader';
import { HapticSwitch } from './components/HapticSwitch';
import { PhoneList } from './components/PhoneList';
import { HistoryPage } from './components/HistoryPage';
import { PrivacyPage } from './components/PrivacyPage';
import { TeamPanel } from './components/TeamPanel';
import { UpdateReady } from './components/UpdateReady';
import { Victory } from './components/Victory';
import { listMatches } from './domain/archive';
import { deviceId } from './domain/device';
import { fanfareEnabled, playFanfare, setFanfareEnabled, shouldPlayFanfare, stopFanfare } from './domain/fanfare';
import { bindCourtTaps, hapticEnabled, needsIosHapticSwitch, pulseHaptic, setHapticEnabled, supportsVibrate } from './domain/haptic';
import { appendEvent, describeEvent, replay } from './domain/log';
import { continuationLog, continueCopy, continueDecision, type ContinueKind } from './domain/continue';
import { commitNewMatch, newMatchCopy } from './domain/newMatch';
import {
  acknowledgeCelebrated,
  celebrationKey,
  currentWin,
  saveCelebrated,
  winBeganOnLastEvent,
  type CelebratedWin,
} from './domain/celebration';
import { colonSetScore, currentHistory } from './domain/history';
import { RULES_SUMMARY, celebrationWinner, courtCue, matchResult, serveCourtLabel, servePickPrompt } from './domain/rules';
import { useInstallOffer } from './hooks/useInstallOffer';
import { useMatch } from './hooks/useMatch';
import { forgetJoinToken, heldJoin, isJoinCodeFragment, readJoinToken, releaseHeldJoin, type JoinAttempt } from './live/protocol';
import { useLive } from './live/useLive';
import { INSTALL_LABEL, IOS_INSTALL_HINT } from './installOffer';
import { watchControllerChange } from './registerServiceWorker';
import { useWakeLock } from './useWakeLock';

function readSession(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

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
  const room = useLive(match.liveRef, match.replaceLog, match.applyLive, match.revertLive, match.readLog, match.archiveLocal);
  const install = useInstallOffer();
  useWakeLock(!match.state.ended);
  const updateReady = useUpdateReady();
  const updateButton = updateReady ? <UpdateReady onReload={() => window.location.reload()} /> : null;
  const [confirming, setConfirming] = useState<'end' | null>(null);
  const [pendingPlan, setPendingPlan] = useState<NewMatchPlan | null>(null);
  const [reconnectChoice, setReconnectChoice] = useState(false);
  const [fanfareOn, setFanfareOn] = useState(() => {
    try {
      return typeof localStorage === 'undefined' ? true : fanfareEnabled(localStorage);
    } catch {
      return true;
    }
  });
  const [hapticOn, setHapticOn] = useState(() => {
    try {
      return typeof localStorage === 'undefined' ? true : hapticEnabled(localStorage);
    } catch {
      return true;
    }
  });
  const fanfarePlayed = useRef<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [continuingId, setContinuingId] = useState<string | null>(null);
  const [screen, setScreen] = useState<ArchiveScreen>(() => {
    if (typeof history === 'undefined') return { view: 'court' };
    return screenFromHistory(history.state);
  });
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectMode, setConnectMode] = useState<'choose' | 'show'>('choose');
  const [phonesOpen, setPhonesOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [hostLinkNote, setHostLinkNote] = useState(false);
  const joinStarted = useRef(false);
  const applyJoin = useCallback((attempt: JoinAttempt) => {
    if (attempt.ok && 'code' in attempt) {
      setHostLinkNote(false);
      setPendingCode(attempt.code);
      return;
    }
    if (attempt.ok) {
      if (attempt.keptHost) setHostLinkNote(true);
      room.connect(attempt.token);
      return;
    }
    if (!attempt.invalid) return;
    room.rejectToken();
    try {
      forgetJoinToken(window.sessionStorage);
    } catch {
      // The address bar is already clear.
    }
  }, [room]);
  useEffect(() => {
    if (joinStarted.current || typeof window === 'undefined') return;
    joinStarted.current = true;
    const held = heldJoin();
    if (held) {
      applyJoin(held);
      return;
    }
    applyJoin(readJoinToken(window.location, window.history, readSession()));
  }, [applyJoin]);
  useEffect(() => {
    if (room.status !== 'live') return;
    releaseHeldJoin();
  }, [room.status]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = () => {
      const hash = window.location.hash;
      const codeLink = isJoinCodeFragment(hash);
      const joinHash = /^#\/join\b/i.test(hash) || codeLink;
      if (room.host && room.status === 'live') {
        if (joinHash) {
          window.history.replaceState({ padelArchive: 'court' }, '', `${window.location.pathname}${window.location.search}`);
        }
        if (codeLink) setHostLinkNote(true);
        return;
      }
      applyJoin(readJoinToken(window.location, window.history, readSession()));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [applyJoin, room.host, room.status]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = (event: PopStateEvent) => {
      const state = event.state as { padelArchive?: string } | null;
      if (!state || state.padelArchive !== 'join') setJoinOpen(false);
      setScreen(screenFromHistory(event.state));
    };
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
  const openConnect = () => {
    setConnectMode('choose');
    setConnectOpen(true);
  };
  const closeJoin = () => {
    if (typeof history !== 'undefined' && (history.state as { padelArchive?: string } | null)?.padelArchive === 'join') {
      history.back();
      return;
    }
    setJoinOpen(false);
  };
  const openJoin = () => {
    if (typeof history !== 'undefined') history.pushState(joinHistoryState(), '');
    setJoinOpen(true);
  };
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
  const result = matchResult(state);
  const winner = result.kind === 'winner' ? result.team : null;
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
  useEffect(() => {
    if (!victoryKey || !shouldPlayFanfare(showVictory, fanfareOn, fanfarePlayed.current, victoryKey)) return;
    fanfarePlayed.current = victoryKey;
    playFanfare();
  }, [showVictory, fanfareOn, victoryKey]);
  const active = state.sets[state.activeSet];
  const cue = courtCue(state);
  const pick = cue ? null : servePickPrompt(state);
  const scoreLine = `${state.teams.a.name} ${active.a}, ${state.teams.b.name} ${active.b}`;
  const serve = serveCourtLabel(state);
  const showFinal = state.ended || winner !== null;
  const finalSets = state.sets.map((set, index) => `Set ${index + 1} ${set.a}–${set.b}`).join(', ');
  const resultLine = result.kind === 'leading'
    ? `${state.teams[result.team].name} leading. ${finalSets}.`
    : result.kind === 'draw'
      ? `Draw. ${finalSets}.`
      : null;
  const live = showVictory && celebrated
    ? `${state.teams[celebrated].name} wins!`
    : showFinal && celebrated
      ? `Final score. ${state.teams[celebrated].name} wins. ${finalSets}.`
      : resultLine
        ? resultLine
        : showFinal
          ? `Match ended. Final score. ${finalSets}.`
          : `Set ${state.activeSet + 1}. ${scoreLine}. ${serve}.${pick ? ` ${pick}.` : ''}${cue ? ` ${cue.text}` : ''}`;
  const historyRows = currentHistory(match.log);
  const played = matches.filter((item) => !item.live);
  const continueActor = (): { id: string; isHost: boolean } => {
    if (room.status === 'live' && !room.host) {
      const seat = room.phones.find((phone) => phone.self)?.seat;
      return { id: seat && seat !== 'host' ? seat : 'guest', isHost: false };
    }
    return { id: 'host', isHost: true };
  };
  const continuingMatch = continuingId ? match.archive.find((item) => item.id === continuingId) ?? null : null;
  const continuingKind: ContinueKind | null = continuingMatch ? continueDecision(continuingMatch, continueActor()) : null;
  const detailMatch = screen.view === 'detail' ? match.archive.find((item) => item.id === screen.id) ?? null : null;
  const continuingOffer = detailMatch ? continueDecision(detailMatch, continueActor()) : null;
  const confirmContinue = () => {
    const archived = continuingMatch;
    const actor = continueActor();
    if (!archived || !continueDecision(archived, actor)) {
      setContinuingId(null);
      return;
    }
    const next = continuationLog(archived, Date.now());
    if (!next) {
      setContinuingId(null);
      return;
    }
    const restoredWin = currentWin(next);
    if (restoredWin) {
      const key = celebrationKey(restoredWin);
      try {
        saveCelebrated(restoredWin, localStorage);
      } catch {
        // Dismissal still applies for this visit when storage is blocked.
      }
      setRemembered(restoredWin);
      setDismissed(key);
      setOpened(null);
    }
    if (room.status === 'live') room.disconnect();
    match.continueMatch(next);
    setContinuingId(null);
    setScreen({ view: 'court' });
    if (typeof history !== 'undefined') {
      const steps = screen.view === 'detail' ? 2 : screen.view === 'matches' ? 1 : 0;
      if (steps > 0 && history.length > steps) history.go(-steps);
      else history.replaceState(null, '');
    }
  };

  if (screen.view === 'privacy') {
    return (
      <div className="app">
        <PrivacyPage onBack={closeArchive} />
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
          onContinue={screen.view === 'detail' && continuingOffer ? () => setContinuingId(screen.id) : undefined}
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
        {continuingKind ? (
          <ConfirmDialog
            titleId="continue-match-title"
            title={continueCopy(continuingKind, room.status === 'live').title}
            body={continueCopy(continuingKind, room.status === 'live').body}
            confirmLabel="Continue"
            confirmTestId="confirm-continue"
            cancelTestId="cancel-continue"
            onCancel={() => setContinuingId(null)}
            onConfirm={confirmContinue}
          />
        ) : null}
        <p className="app-version" data-testid="app-version">{`v${import.meta.env.APP_VERSION}`}</p>
        {updateButton}
      </div>
    );
  }

  const leaveLive = () => {
    room.disconnect();
    try {
      forgetJoinToken(sessionStorage);
    } catch {
      // Storage may be blocked. The in-memory token is already cleared.
    }
  };
  const actions: readonly CourtAction[] = [
    ...(room.joining ? [] : [{ id: 'connect', label: 'Connect', testId: 'connect-open', onSelect: openConnect }]),
    ...(room.status === 'live'
      ? [{ id: 'leave', label: 'Leave live match', testId: 'leave-live-menu', onSelect: leaveLive }]
      : []),
    { id: 'history', label: 'History', testId: 'history-open', onSelect: openMatches },
    state.ended
      ? { id: 'resume', label: 'Resume', testId: 'resume-match', emphasized: true, onSelect: match.resumeMatch }
      : { id: 'end', label: 'End match', testId: 'end-match', onSelect: () => setConfirming('end') },
    {
      id: 'reset',
      label: 'New match',
      testId: 'new-match',
      onSelect: () => {
        const plan = planNewMatch({
          host: room.status !== 'live' || room.host,
          open: isOpenMatch(state),
          lastEventAt: lastChangeAt(state.createdAt, match.log.events.map((event) => event.at)),
          now: Date.now(),
          coPlayers: room.status === 'live'
            ? otherPhones({ phones: room.phones, onlinePlayers: room.players })
            : 0,
        });
        setReconnectChoice(plan.reconnectSelected);
        setPendingPlan(plan);
      },
    },
    {
      id: 'fanfare',
      label: fanfareOn ? 'Victory sound: On' : 'Victory sound: Off',
      testId: 'fanfare-toggle',
      onSelect: () => {
        const next = !fanfareOn;
        setFanfareOn(next);
        try {
          setFanfareEnabled(localStorage, next);
        } catch {
          // Storage may be blocked. This visit still uses the choice.
        }
      },
    },
    {
      id: 'haptic',
      label: hapticOn ? 'Haptic feedback: On' : 'Haptic feedback: Off',
      testId: 'haptic-toggle',
      onSelect: () => {
        const next = !hapticOn;
        setHapticOn(next);
        try {
          setHapticEnabled(localStorage, next);
        } catch {
          // Storage may be blocked. This visit still uses the choice.
        }
      },
    },
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

  const commitPlanned = (plan: NewMatchPlan, takePhones: boolean) => {
    const acting = takePhones ? { ...plan, kind: 'finish' as const } : plan;
    const at = Date.now();
    const by = acting.kind === 'leave' ? deviceId(localStorage) : 'host';
    const commit = commitNewMatch(acting, at, by);
    const endEvent = commit.events[0] ?? { type: 'match/end' as const, at, by };
    const previous = commit.endOnServer && room.status === 'live'
      ? room.finishShared(endEvent, scoreClaimFor(replay(match.log), endEvent))
      : null;
    if (!commit.endOnServer) room.disconnect();
    let shared = match.log;
    for (const event of commit.events) shared = appendEvent(shared, event);
    match.recordAll(commit.events);
    if (takePhones && previous) {
      room.share(shared, { previousHostToken: previous, carry: true });
    } else if (!takePhones && plan.showReconnect && reconnectChoice && previous) {
      room.share(shared, { previousHostToken: previous, carry: true });
    }
  };

  const taps = bindCourtTaps(state.activeSet, match);
  const hapticMode = !hapticOn ? 'off' : needsIosHapticSwitch() ? 'ios' : supportsVibrate() ? 'vibrate' : 'off';

  return (
    <div className={room.courtTone === 'local' ? 'app' : `app is-${room.courtTone}`}>
      <CourtHeader
        setLabel={`Set ${state.activeSet + 1}`}
        onBrand={openMatches}
        actions={actions}
        phoneCount={room.status === 'live' ? (room.phones.length > 0 ? room.phones.filter((phone) => phone.online).length : room.players) : null}
        onPhones={room.status === 'live' ? () => setPhonesOpen(true) : undefined}
        version={import.meta.env.APP_VERSION}
      />
      {showVictory && screen.view === 'court' && celebrated ? (
        <Victory
          name={state.teams[celebrated].name}
          team={celebrated}
          reducedMotion={reducedMotion}
          onClose={() => {
            stopFanfare();
            setDismissed(victoryKey);
          }}
        />
      ) : null}
      <main className="board">
        <TeamPanel
          team="a"
          state={state}
          onIncrement={taps.onIncrement}
          onDecrement={taps.onDecrement}
          onRename={match.rename}
          onSelectSet={taps.onSelectSet}
          onServe={taps.onServe}
          hapticMode={hapticMode}
          onHaptic={() => pulseHaptic(hapticOn)}
          serveCue={cue?.kind === 'choose-serve'}
        />
        <div className="mid">
          {result.kind === 'leading' ? (
            <span className={`chip chip-${result.team}`} data-testid="match-result">{`${state.teams[result.team].name} leading`}</span>
          ) : result.kind === 'draw' ? (
            <span className="chip chip-ended" data-testid="match-result">Draw</span>
          ) : state.ended ? (
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
          {cue ? (
            <p className="serve-cue" data-testid={cue.kind === 'tiebreak' ? 'tiebreak-hint' : cue.kind === 'next-set' ? 'next-set-hint' : 'serve-cue'}>
              {cue.text}
            </p>
          ) : null}
          {pick ? (
            <p className="serve-prompt" data-testid="serve-prompt">
              {pick}
            </p>
          ) : null}
          {room.courtTone === 'offline' ? (
            <p className="offline-label" data-testid="court-offline">Offline</p>
          ) : null}
          {room.movedNote ? (
            <p className="live-error" role="status" data-testid="new-match-notice">New match</p>
          ) : null}
          {room.keptNote ? (
            <p className="live-error" role="status" data-testid="offline-kept">
              Points entered offline are in History. They were not taken across.
            </p>
          ) : null}
          {room.continued ? (
            <p className="live-error" role="status" data-testid="continued-notice">
              This match has ended. The other phones continued in a new match. Scan a new code to join them.
            </p>
          ) : null}
          {room.joining && room.status === 'connecting' ? (
            <p className="join-status" data-testid="join-status">Connecting to the match…</p>
          ) : null}
          {hostLinkNote ? (
            <p className="live-error" role="status" data-testid="host-link-ignored">
              You are already the host. This link was not used.
            </p>
          ) : null}
          {room.joinError ? (
            <div className="join-error" role="alert" data-testid="join-error">
              <p>Could not join this match.</p>
              <p>{room.joinError}</p>
            </div>
          ) : null}
          {room.status === 'disconnected' ? (
            <>
              <p className="live-error" role="status" data-testid="live-disconnected">Disconnected.</p>
              <p className="live-hint" data-testid="disconnected-hint">Points stay on this phone.</p>
            </>
          ) : null}
          {room.error ? (
            <p className="live-error" role="alert" data-testid="live-error">{room.error}</p>
          ) : null}
          {room.pendingRestore.length > 0 ? (
            <div className="restore-points" data-testid="restore-points">
              <p>These points could not be matched. Adding them counts them again on top of the current score. They might already be in the match.</p>
              <ul>
                {room.pendingRestore.map((item) => (
                  <li key={item.id}>{describeEvent(item.event)}</li>
                ))}
              </ul>
              <button
                type="button"
                className="btn-solid"
                data-testid="restore-points-add"
                onClick={() => {
                  for (const event of room.commitRestore()) match.reapply(event);
                }}
              >
                Count them again
              </button>
            </div>
          ) : null}
        </div>
        <TeamPanel
          team="b"
          state={state}
          onIncrement={taps.onIncrement}
          onDecrement={taps.onDecrement}
          onRename={match.rename}
          onSelectSet={taps.onSelectSet}
          onServe={taps.onServe}
          hapticMode={hapticMode}
          onHaptic={() => pulseHaptic(hapticOn)}
          serveCue={cue?.kind === 'choose-serve'}
        />
      </main>
      <footer className="foot court-foot">
        {match.saveFailed ? <p className="save-note">Saving on this device failed.</p> : null}
        <p className="rules">{RULES_SUMMARY}</p>
      </footer>
      {updateButton}
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      <p className="sr-only" role="status" data-testid="court-connection">
        {room.courtTone === 'offline'
          ? 'Live match offline. Points stay on this phone until the connection returns.'
          : room.courtTone === 'online'
            ? 'Live match connected.'
            : room.status === 'disconnected'
              ? 'Disconnected from the live match. Points stay on this phone.'
              : ''}
      </p>
      {pendingPlan ? (
        <ConfirmDialog
          titleId="new-match-title"
          title={newMatchCopy(pendingPlan).title}
          body={newMatchCopy(pendingPlan).body}
          confirmLabel={newMatchCopy(pendingPlan).confirmLabel}
          confirmTestId={newMatchCopy(pendingPlan).confirmTestId}
          cancelTestId="cancel-new-match"
          check={pendingPlan.showReconnect ? {
            label: 'Reconnect players from last match',
            checked: reconnectChoice,
            testId: 'reconnect-players',
            onChange: setReconnectChoice,
          } : undefined}
          alternateLabel={newMatchCopy(pendingPlan).alternateLabel}
          alternateTestId={newMatchCopy(pendingPlan).alternateTestId}
          onCancel={() => setPendingPlan(null)}
          onAlternate={() => {
            const plan = pendingPlan;
            setPendingPlan(null);
            commitPlanned(plan, false);
          }}
          onConfirm={() => {
            const plan = pendingPlan;
            setPendingPlan(null);
            commitPlanned(plan, plan.askCarry);
          }}
        />
      ) : null}
      {phonesOpen && room.status === 'live' ? (
        <PhoneList
          phones={room.phones}
          onClose={() => setPhonesOpen(false)}
          onKick={(seat) => {
            const mine = room.phones.find((phone) => phone.self);
            if (mine?.seat === seat) return;
            room.kick(seat);
          }}
        />
      ) : null}
      {connectOpen ? (
        <ConnectPage
          configured={room.configured}
          mode={connectMode}
          status={room.status === 'disconnected' ? 'off' : room.status}
          players={room.players}
          qr={room.qr}
          code={room.code}
          error={room.error}
          onShow={() => {
            setConnectMode('show');
            room.share(match.log);
          }}
          onScan={() => {
            setConnectOpen(false);
            openJoin();
          }}
          onRotate={room.rotate}
          onLeave={() => {
            room.disconnect();
            try {
              forgetJoinToken(window.sessionStorage);
            } catch {
              // Storage may be blocked.
            }
          }}
          onClose={() => setConnectOpen(false)}
        />
      ) : null}
      {joinOpen ? (
        <JoinMatchPage
          configured={room.configured}
          error={room.joinError}
          pageHref={typeof location === 'undefined' ? 'https://patrickstubner.github.io/PadelCounterV2/' : location.href}
          onCode={(code) => {
            void room.joinByCode(code).then((ok) => {
              if (ok) closeJoin();
            });
          }}
          onToken={(token) => {
            closeJoin();
            room.connect(token);
          }}
          onClose={closeJoin}
        />
      ) : null}
      {pendingCode ? (
        <ConfirmDialog
          titleId="join-link-title"
          title="Join this match?"
          body="The score on this phone will be replaced. A match you already started is kept in History."
          confirmLabel="Join"
          confirmTestId="confirm-join-link"
          cancelTestId="cancel-join-link"
          onCancel={() => setPendingCode(null)}
          onConfirm={() => {
            const code = pendingCode;
            setPendingCode(null);
            void room.joinByCode(code);
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
      {needsIosHapticSwitch() ? <HapticSwitch /> : null}
    </div>
  );
}
