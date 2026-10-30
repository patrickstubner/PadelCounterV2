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

/** Score first. The tick never blocks the point, and the current set does not tick again. */
export function bindCourtTaps(activeSet: SetIndex, target: CourtTapTarget, pulse: () => void): CourtTaps {
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
