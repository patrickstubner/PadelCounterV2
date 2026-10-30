/** @vitest-environment happy-dom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { HAPTIC_KEY, HAPTIC_MS, registerHapticSwitch } from './domain/haptic';

const vibrateCalls: number[] = [];

function setVibrate(fn: ((pattern: number | number[]) => boolean) | undefined): void {
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    writable: true,
    value: fn,
  });
}

function enableSwitch(): void {
  Object.defineProperty(HTMLInputElement.prototype, 'switch', {
    configurable: true,
    writable: true,
    value: false,
  });
}

function disableSwitch(): void {
  Reflect.deleteProperty(HTMLInputElement.prototype, 'switch');
}

async function mountApp(): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  return { root, container };
}

async function unmount(root: Root, container: HTMLDivElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

async function press(testId: string): Promise<void> {
  const node = document.querySelector(`[data-testid="${testId}"]`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`missing button ${testId}`);
  await act(async () => {
    node.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      pointerType: 'touch',
    }));
    node.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      pointerType: 'touch',
    }));
    node.click();
  });
}

function scoreA(): string {
  return document.querySelector('[data-testid="current-a"]')?.textContent ?? '';
}

describe('haptic taps on the court', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
  let labelClick = HTMLLabelElement.prototype.click;

  afterEach(async () => {
    for (const view of mounted.splice(0)) await unmount(view.root, view.container);
    localStorage.clear();
    vibrateCalls.length = 0;
    setVibrate(undefined);
    disableSwitch();
    HTMLLabelElement.prototype.click = labelClick;
    registerHapticSwitch(null);
    document.documentElement.scrollTop = 0;
  });

  it('vibrates on plus, minus, the serve ball, and a set change, and not when that set is already open', async () => {
    labelClick = HTMLLabelElement.prototype.click;
    setVibrate((pattern) => {
      vibrateCalls.push(typeof pattern === 'number' ? pattern : pattern[0] ?? -1);
      return true;
    });
    const view = await mountApp();
    mounted.push(view);
    expect(document.querySelector('[data-testid="haptic-switch"]')).toBeNull();
    await press('increment-a');
    await press('decrement-a');
    await press('serve-a');
    await press('increment-b');
    await press('set-a-2');
    expect(document.querySelector('[data-testid="active-set"]')?.textContent).toContain('Set 2');
    await press('set-a-2');
    await press('set-b-2');
    expect(vibrateCalls).toEqual([HAPTIC_MS, HAPTIC_MS, HAPTIC_MS, HAPTIC_MS, HAPTIC_MS]);
  });

  it('does not vibrate a disabled minus or when the setting is off', async () => {
    labelClick = HTMLLabelElement.prototype.click;
    setVibrate((pattern) => {
      vibrateCalls.push(typeof pattern === 'number' ? pattern : pattern[0] ?? -1);
      return true;
    });
    const view = await mountApp();
    mounted.push(view);
    const minus = document.querySelector('[data-testid="decrement-a"]');
    expect(minus).toBeInstanceOf(HTMLButtonElement);
    expect((minus as HTMLButtonElement).disabled).toBe(true);
    await press('decrement-a');
    expect(vibrateCalls).toEqual([]);
    expect(scoreA()).toContain('0');
    expect(document.querySelector('[data-testid="haptic-toggle"]')?.textContent).toContain('Haptic feedback: On');
    await press('haptic-toggle');
    expect(localStorage.getItem(HAPTIC_KEY)).toBe('off');
    expect(document.querySelector('[data-testid="haptic-toggle"]')?.textContent).toContain('Haptic feedback: Off');
    await press('increment-a');
    await press('serve-b');
    await press('set-b-3');
    expect(vibrateCalls).toEqual([]);
    expect(scoreA()).toContain('1');
  });

  it('does not vibrate when the finger scrolls or the pointer is cancelled', async () => {
    labelClick = HTMLLabelElement.prototype.click;
    setVibrate((pattern) => {
      vibrateCalls.push(typeof pattern === 'number' ? pattern : pattern[0] ?? -1);
      return true;
    });
    const view = await mountApp();
    mounted.push(view);
    const plus = document.querySelector('[data-testid="increment-a"]');
    if (!(plus instanceof HTMLButtonElement)) throw new Error('missing plus');
    await act(async () => {
      plus.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, pointerId: 7, clientX: 4, clientY: 4, pointerType: 'touch',
      }));
      plus.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, button: 0, pointerId: 7, clientX: 40, clientY: 4, pointerType: 'touch',
      }));
      plus.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, button: 0, pointerId: 7, clientX: 40, clientY: 4, pointerType: 'touch',
      }));
    });
    expect(vibrateCalls).toEqual([]);
    expect(scoreA()).toContain('0');
    await act(async () => {
      plus.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, pointerId: 8, clientX: 4, clientY: 4, pointerType: 'touch',
      }));
      plus.dispatchEvent(new PointerEvent('pointercancel', {
        bubbles: true, pointerId: 8, pointerType: 'touch',
      }));
      plus.click();
    });
    expect(vibrateCalls).toEqual([]);
    expect(scoreA()).toContain('1');
  });

  it('still scores when vibrate throws', async () => {
    labelClick = HTMLLabelElement.prototype.click;
    setVibrate(() => {
      throw new Error('blocked');
    });
    const view = await mountApp();
    mounted.push(view);
    await press('increment-a');
    expect(scoreA()).toContain('1');
  });

  it('clicks the hidden iOS switch, keeps focus, and does not scroll', async () => {
    labelClick = HTMLLabelElement.prototype.click;
    setVibrate(undefined);
    enableSwitch();
    let clicks = 0;
    HTMLLabelElement.prototype.click = function click(this: HTMLLabelElement) {
      clicks += 1;
      const input = this.ownerDocument?.getElementById(this.htmlFor);
      if (input instanceof HTMLElement) input.focus();
      this.ownerDocument.documentElement.scrollTop = 48;
      return undefined;
    };
    const view = await mountApp();
    mounted.push(view);
    const host = document.querySelector('[data-testid="haptic-switch"]');
    expect(host).toBeInstanceOf(HTMLElement);
    const box = host as HTMLElement;
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(box.style.position).toBe('fixed');
    expect(box.style.width).toBe('1px');
    expect(box.style.height).toBe('1px');
    expect(box.style.opacity).toBe('0');
    expect(box.style.pointerEvents).toBe('none');
    expect(box.style.display).not.toBe('none');
    expect(document.querySelector('.board')?.contains(box)).toBe(false);
    const input = box.querySelector('input');
    const label = box.querySelector('label');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(label).toBeInstanceOf(HTMLLabelElement);
    const field = input as HTMLInputElement;
    const caption = label as HTMLLabelElement;
    expect(field.type).toBe('checkbox');
    expect(field.hasAttribute('switch')).toBe(true);
    expect(field.tabIndex).toBe(-1);
    expect(field.getAttribute('aria-hidden')).toBe('true');
    expect(field.getAttribute('name')).toBeNull();
    expect(caption.htmlFor).toBe(field.id);
    expect(caption.tabIndex).toBe(-1);
    expect(caption.getAttribute('aria-hidden')).toBe('true');
    const plus = document.querySelector('[data-testid="increment-a"]');
    expect(plus).toBeInstanceOf(HTMLButtonElement);
    (plus as HTMLButtonElement).focus();
    document.documentElement.scrollTop = 0;
    await press('increment-a');
    expect(clicks).toBe(1);
    expect(document.activeElement).toBe(plus);
    expect(document.activeElement).not.toBe(field);
    expect(document.documentElement.scrollTop).toBe(0);
    expect(scoreA()).toContain('1');
    await press('haptic-toggle');
    await press('serve-a');
    await press('set-a-2');
    expect(clicks).toBe(1);
    expect(localStorage.getItem(HAPTIC_KEY)).toBe('off');
  });

  it('scores with no vibration API and no switch', async () => {
    labelClick = HTMLLabelElement.prototype.click;
    setVibrate(undefined);
    disableSwitch();
    let clicks = 0;
    HTMLLabelElement.prototype.click = function click(this: HTMLLabelElement) {
      clicks += 1;
      return labelClick.call(this);
    };
    const view = await mountApp();
    mounted.push(view);
    expect(document.querySelector('[data-testid="haptic-switch"]')).toBeNull();
    await expect(press('increment-a')).resolves.toBeUndefined();
    await press('serve-a');
    await press('set-a-3');
    expect(scoreA()).toContain('1');
    expect(document.querySelector('[data-testid="active-set"]')?.textContent).toContain('Set 3');
    expect(clicks).toBe(0);
    expect(typeof navigator.vibrate).not.toBe('function');
  });
});
