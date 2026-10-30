import { useRef, useState, type PointerEvent } from 'react';
import { createPressHaptic, releaseInside, type HapticPoint, type PressHaptic } from '../domain/haptic';
import { canIncrement, canTakeGame, displayGames, isUpcomingSet, serveChoice, setWinner } from '../domain/rules';
import type { MatchState, SetIndex, TeamId } from '../domain/types';
import { BallIcon, MinusIcon, PlusIcon } from './icons';
import { SetScore } from './SetScore';
import { SplitFlap } from './SplitFlap';
import { TeamName } from './TeamName';

interface TeamPanelProps {
  team: TeamId;
  state: MatchState;
  onIncrement: (team: TeamId) => void;
  onDecrement: (team: TeamId) => void;
  onRename: (team: TeamId, name: string) => void;
  onSelectSet: (index: SetIndex) => void;
  onServe: (team: TeamId) => void;
  /** vibrate ticks on pointer down. ios ticks on click. off is quiet. */
  hapticMode?: 'vibrate' | 'ios' | 'off';
  onHaptic?: () => void;
  /** Pulse the serve ball until a serving team is chosen. */
  serveCue?: boolean;
}

const SETS: readonly SetIndex[] = [0, 1, 2];

function pointOf(event: PointerEvent<HTMLButtonElement>): HapticPoint {
  return {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    button: event.button,
    pointerType: event.pointerType,
  };
}

function useVibratePress(mode: 'vibrate' | 'ios' | 'off', onHaptic: () => void): PressHaptic | null {
  const pulseRef = useRef(onHaptic);
  pulseRef.current = onHaptic;
  const [press] = useState(() => createPressHaptic(() => pulseRef.current()));
  return mode === 'vibrate' ? press : null;
}

export function TeamPanel({
  team,
  state,
  onIncrement,
  onDecrement,
  onRename,
  onSelectSet,
  onServe,
  hapticMode = 'off',
  onHaptic = () => undefined,
  serveCue = false,
}: TeamPanelProps) {
  const name = state.teams[team].name;
  const active = state.sets[state.activeSet];
  const locked = state.ended;
  const plusDisabled = locked || !canIncrement(active, team);
  const minusDisabled = locked || !canTakeGame(state, team);
  const activeWinner = setWinner(active.a, active.b);
  const asking = state.serveAsk === team && state.serve === null;
  const serving = state.serve?.team === team || asking;
  const nextServe = serveChoice(state.serve, team);
  const serveLabel = asking
    ? `Choose the player for ${name}`
    : nextServe
      ? `Serve ${nextServe.team.toUpperCase()}${nextServe.player} for ${name}`
      : `Leave the serve open, ${name}`;
  const press = useVibratePress(hapticMode, onHaptic);
  const skipClick = useRef(false);
  const afterClick = () => {
    if (hapticMode === 'ios') onHaptic();
    else if (hapticMode === 'vibrate') press?.click();
  };
  const bind = (disabled: boolean) => press ? {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      skipClick.current = false;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The tick still follows the pointer events that do arrive.
      }
      press.down(pointOf(event), !disabled && !event.currentTarget.disabled);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => press.move(pointOf(event)),
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const inside = releaseInside(rect, event.clientX, event.clientY);
      if (event.pointerType === 'mouse') skipClick.current = !inside;
      press.up(pointOf(event), !disabled && !event.currentTarget.disabled && inside);
    },
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => press.cancel(event.pointerId),
    onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.pointerType === 'mouse' && !releaseInside(rect, event.clientX, event.clientY)) {
        skipClick.current = true;
      }
      press.cancel(event.pointerId);
    },
  } : {};

  return (
    <section className={`team team-${team}`} aria-label={name}>
      <button
        type="button"
        className="step step-minus"
        data-testid={`decrement-${team}`}
        disabled={minusDisabled}
        aria-label={`${name}: remove one game`}
        onClick={() => {
          if (skipClick.current) {
            skipClick.current = false;
            press?.forget();
            return;
          }
          onDecrement(team);
          if (!minusDisabled) afterClick();
        }}
        {...bind(minusDisabled)}
      >
        <MinusIcon />
      </button>
      <div className="team-body">
        <div className="team-head">
          <TeamName name={name} locked={locked} onCommit={(next) => onRename(team, next)} />
          <button
            type="button"
            className={['ball', serving ? 'is-on' : '', serveCue ? 'is-cue' : ''].filter(Boolean).join(' ')}
            data-testid={`serve-${team}`}
            aria-pressed={serving}
            aria-label={serveLabel}
            disabled={locked}
            onClick={() => {
              if (skipClick.current) {
                skipClick.current = false;
                press?.forget();
                return;
              }
              onServe(team);
              if (!locked) afterClick();
            }}
            {...bind(locked)}
          >
            <BallIcon />
            {serving && state.serve ? (
              <span className="serve-player" data-testid={`serve-player-${team}`}>
                {state.serve.player}
              </span>
            ) : null}
          </button>
        </div>
        <div className={`current-set${activeWinner === team ? ' is-won' : ''}`} data-testid={`current-${team}`} aria-hidden="true">
          <SplitFlap value={displayGames(state, state.activeSet, team)} />
        </div>
        <div className="sets">
          {SETS.map((index) => {
            const score = state.sets[index];
            const winner = setWinner(score.a, score.b);
            return (
              <SetScore
                key={index}
                team={team}
                index={index}
                gamesLabel={displayGames(state, index, team)}
                active={state.activeSet === index}
                won={winner === team}
                upcoming={isUpcomingSet(state, index)}
                locked={locked}
                press={press}
                hapticOnPress={!locked && index !== state.activeSet}
                onSelect={() => {
                  const changed = index !== state.activeSet;
                  onSelectSet(index);
                  if (changed) afterClick();
                }}
              />
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="step step-plus"
        data-testid={`increment-${team}`}
        disabled={plusDisabled}
        aria-label={`${name}: add one game`}
        onClick={() => {
          if (skipClick.current) {
            skipClick.current = false;
            press?.forget();
            return;
          }
          onIncrement(team);
          if (!plusDisabled) afterClick();
        }}
        {...bind(plusDisabled)}
      >
        <PlusIcon />
      </button>
    </section>
  );
}
