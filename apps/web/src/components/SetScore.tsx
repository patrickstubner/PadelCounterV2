import type { PointerEvent } from 'react';
import type { HapticPoint, PressHaptic } from '../domain/haptic';
import { SplitFlap } from './SplitFlap';

interface SetScoreProps {
  team: 'a' | 'b';
  index: number;
  gamesLabel: string;
  active: boolean;
  won: boolean;
  upcoming: boolean;
  locked: boolean;
  onSelect: () => void;
  press?: PressHaptic | null;
  hapticOnPress?: boolean;
}

function pointOf(event: PointerEvent<HTMLButtonElement>): HapticPoint {
  return {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    button: event.button,
    pointerType: event.pointerType,
  };
}

export function SetScore({
  team,
  index,
  gamesLabel,
  active,
  won,
  upcoming,
  locked,
  onSelect,
  press,
  hapticOnPress,
}: SetScoreProps) {
  const classes = [
    'set',
    active ? 'is-active' : '',
    won ? 'is-won' : '',
    upcoming ? 'is-upcoming' : '',
    !active && !upcoming ? 'is-played' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      data-testid={`set-${team}-${index + 1}`}
      aria-pressed={active}
      disabled={locked}
      aria-label={`Set ${index + 1}`}
      onClick={onSelect}
      onPointerDown={(event) => {
        if (!press || !hapticOnPress) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // The tick still follows the pointer events that do arrive.
        }
        press.down(pointOf(event), !event.currentTarget.disabled);
      }}
      onPointerMove={(event) => press?.move(pointOf(event))}
      onPointerUp={(event) => press?.up(pointOf(event), !event.currentTarget.disabled && hapticOnPress === true)}
      onPointerCancel={(event) => press?.cancel(event.pointerId)}
    >
      <SplitFlap value={gamesLabel} />
      <span className="marker" aria-hidden="true" />
    </button>
  );
}
