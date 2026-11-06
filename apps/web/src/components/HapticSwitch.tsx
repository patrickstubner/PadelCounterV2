import { useCallback, useLayoutEffect, useRef } from 'react';
import { registerHapticSwitch } from '../domain/haptic';

/** Fixed 1px box. `display: none` would skip the iOS tick, and a static box would move the court. */
const HIDDEN_BOX = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '1px',
  height: '1px',
  margin: 0,
  padding: 0,
  border: 0,
  opacity: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  zIndex: -1,
} as const;

function markSwitch(node: HTMLInputElement): void {
  try {
    node.setAttribute('switch', '');
    const field = node as HTMLInputElement & { switch?: boolean };
    if ('switch' in HTMLInputElement.prototype) field.switch = true;
  } catch {
    // Older engines ignore the attribute.
  }
}

function restoreFocus(input: HTMLInputElement, previous: HTMLElement | null): void {
  try {
    if (
      previous
      && previous.isConnected
      && previous !== input
      && previous !== document.body
      && previous !== document.documentElement
    ) {
      try {
        previous.focus({ preventScroll: true });
      } catch {
        previous.focus();
      }
      if (document.activeElement !== input) return;
    }
  } catch {
    // Fall through and blur the switch.
  }
  try {
    input.blur();
  } catch {
    // A locked-down frame can refuse focus changes.
  }
}

function restoreScroll(x: number, y: number, top: number, left: number, root: Element | null): void {
  try {
    if (root) {
      if (root.scrollTop !== top) root.scrollTop = top;
      if (root.scrollLeft !== left) root.scrollLeft = left;
    }
    if ((window.scrollX || 0) !== x || (window.scrollY || 0) !== y) window.scrollTo(x, y);
  } catch {
    // Scroll restoration is best-effort.
  }
}

/**
 * Hidden iOS 18 switch. The label click is what ticks. The input is not tabbable,
 * and focus returns to the control that had it so the court does not scroll.
 */
export function HapticSwitch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLLabelElement>(null);
  const previousRef = useRef<HTMLElement | null>(null);
  const restoring = useRef(false);
  const id = 'pcv2-haptic-switch';

  const takeInput = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (node) markSwitch(node);
  }, []);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const label = labelRef.current;
    if (!input || !label) {
      registerHapticSwitch(null);
      return;
    }
    markSwitch(input);
    const onFocus = () => {
      if (restoring.current) return;
      restoring.current = true;
      try {
        restoreFocus(input, previousRef.current);
      } finally {
        restoring.current = false;
      }
    };
    input.addEventListener('focus', onFocus);
    registerHapticSwitch(() => {
      const field = inputRef.current;
      const control = labelRef.current;
      if (!field || !control) return;
      const active = document.activeElement;
      previousRef.current = active instanceof HTMLElement && active !== field ? active : null;
      const root = document.scrollingElement;
      const x = window.scrollX || 0;
      const y = window.scrollY || 0;
      const top = root?.scrollTop ?? 0;
      const left = root?.scrollLeft ?? 0;
      try {
        control.click();
      } catch {
        // The label can be missing on an older engine.
      } finally {
        if (!restoring.current) {
          restoring.current = true;
          try {
            restoreFocus(field, previousRef.current);
          } finally {
            restoring.current = false;
          }
        }
        restoreScroll(x, y, top, left, root);
      }
    });
    return () => {
      input.removeEventListener('focus', onFocus);
      registerHapticSwitch(null);
    };
  }, []);

  return (
    <div data-testid="haptic-switch" aria-hidden="true" style={HIDDEN_BOX}>
      <input
        ref={takeInput}
        id={id}
        type="checkbox"
        tabIndex={-1}
        aria-hidden="true"
        style={HIDDEN_BOX}
      />
      <label ref={labelRef} htmlFor={id} aria-hidden="true" tabIndex={-1} style={HIDDEN_BOX} />
    </div>
  );
}
