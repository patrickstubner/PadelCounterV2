import type { SetIndex, TeamId } from './types';

/** Tap feedback. Missing means on. Stored values are `on` and `off`. */
export const HAPTIC_KEY = 'pcv2:haptic';

/** One tick. Stays inside 10–15 ms so it is a tap, not a buzz. */
export const HAPTIC_MS = 15;

export function hapticEnabled(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(HAPTIC_KEY) !== 'off';
}

export function setHapticEnabled(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  storage.setItem(HAPTIC_KEY, enabled ? 'on' : 'off');
}

export function supportsVibrate(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  } catch {
    return false;
  }
}

/** WebKit exposes `switch` on checkbox inputs. iOS 18 ticks when that control toggles. */
export function supportsCheckboxSwitch(): boolean {
  try {
    return typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;
  } catch {
    return false;
  }
}

/** iPhone fallback only. Android already has `navigator.vibrate`, so it does not mount the control. */
export function needsIosHapticSwitch(): boolean {
  return !supportsVibrate() && supportsCheckboxSwitch();
}

export interface HapticEnv {
  readonly vibrate: ((ms: number) => void) | null;
  readonly clickSwitch: (() => void) | null;
  readonly switchSupported: boolean;
}

let clickSwitch: (() => void) | null = null;

export function registerHapticSwitch(click: (() => void) | null): void {
  clickSwitch = click;
}

function readVibrate(): ((ms: number) => void) | null {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
    const nav = navigator;
    return (ms: number) => {
      nav.vibrate(ms);
    };
  } catch {
    return null;
  }
}

/**
 * One tick after a court tap. Android uses Vibration. iPhone clicks a switch label.
 * A missing API, or a throw, stays quiet.
 */
export function pulseHaptic(enabled: boolean, env?: HapticEnv): void {
  if (!enabled) return;
  const resolved = env ?? {
    vibrate: readVibrate(),
    clickSwitch,
    switchSupported: supportsCheckboxSwitch(),
  };
  try {
    if (resolved.vibrate) {
      resolved.vibrate(HAPTIC_MS);
      return;
    }
  } catch {
    return;
  }
  if (!resolved.switchSupported) return;
  try {
    resolved.clickSwitch?.();
  } catch {
    // An older WebKit has no switch tick. The score still stands.
  }
}

export interface CourtTapTarget {
  increment: (team: TeamId) => void;
  decrement: (team: TeamId) => void;
  chooseServe: (team: TeamId) => void;
  selectSet: (index: SetIndex) => void;
}

export interface CourtTaps {
  onIncrement: (team: TeamId) => void;
  onDecrement: (team: TeamId) => void;
  onServe: (team: TeamId) => void;
  onSelectSet: (index: SetIndex) => void;
}

/** Score first when a tick is passed in. The court buttons tick on their own gesture. */
export function bindCourtTaps(activeSet: SetIndex, target: CourtTapTarget, pulse: () => void = () => undefined): CourtTaps {
  return {
    onIncrement: (team) => {
      target.increment(team);
      pulse();
    },
    onDecrement: (team) => {
      target.decrement(team);
      pulse();
    },
    onServe: (team) => {
      target.chooseServe(team);
      pulse();
    },
    onSelectSet: (index) => {
      const changed = index !== activeSet;
      target.selectSet(index);
      if (changed) pulse();
    },
  };
}

/** Movement past this many pixels is a scroll, not a tap. */
export const HAPTIC_SLOP_PX = 12;

export interface HapticPoint {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly pointerType: string;
}

export interface PressHaptic {
  down(point: HapticPoint, allow: boolean): void;
  move(point: HapticPoint): void;
  up(point: HapticPoint, allow: boolean): void;
  cancel(pointerId: number): void;
  /** Click ticks only when no pointer gesture already accepted or rejected this tap. */
  click(): void;
}

interface ArmedPress {
  pointerId: number;
  x: number;
  y: number;
  frame: number;
  fired: boolean;
  dropped: boolean;
}

/**
 * Vibration on pointer down, before the click that counts the point.
 * A move past the slop, or a cancel, drops the tick. Pointer up ticks at most once
 * if the frame has not already fired. The click must not tick again.
 */
export function createPressHaptic(pulse: () => void): PressHaptic {
  let pending: ArmedPress | null = null;
  let suppressClick = false;
  const schedule = (fn: () => void): number => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
    fn();
    return 0;
  };
  const cancelFrame = (frame: number) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  };
  return {
    down(point, allow) {
      if (!allow || (point.pointerType === 'mouse' && point.button !== 0)) return;
      suppressClick = false;
      if (pending) cancelFrame(pending.frame);
      const armed: ArmedPress = {
        pointerId: point.pointerId,
        x: point.x,
        y: point.y,
        frame: 0,
        fired: false,
        dropped: false,
      };
      pending = armed;
      armed.frame = schedule(() => {
        if (pending !== armed || armed.dropped || armed.fired) return;
        armed.fired = true;
        try {
          pulse();
        } catch {
          // The score is a later click. A tick must not block it.
        }
      });
    },
    move(point) {
      if (!pending || pending.pointerId !== point.pointerId || pending.fired || pending.dropped) return;
      const dx = point.x - pending.x;
      const dy = point.y - pending.y;
      if (dx * dx + dy * dy <= HAPTIC_SLOP_PX * HAPTIC_SLOP_PX) return;
      pending.dropped = true;
      suppressClick = true;
      cancelFrame(pending.frame);
    },
    up(point, allow) {
      if (!pending || pending.pointerId !== point.pointerId) return;
      const armed = pending;
      pending = null;
      cancelFrame(armed.frame);
      suppressClick = true;
      if (armed.dropped || armed.fired || !allow) return;
      armed.fired = true;
      try {
        pulse();
      } catch {
        // The click still counts the point.
      }
    },
    cancel(pointerId) {
      if (!pending || pending.pointerId !== pointerId) return;
      pending.dropped = true;
      cancelFrame(pending.frame);
      pending = null;
      suppressClick = true;
    },
    click() {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      try {
        pulse();
      } catch {
        // The point is already counted.
      }
    },
  };
}
