/** @vitest-environment happy-dom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { STAY_AWAKE_FILE, createStayAwakeVideo } from './stayAwakeVideo';
import { useWakeLock } from './useWakeLock';
import { withBase } from './url';
import type { WakeLockHandle } from './wakeLock';

class FakeSentinel implements WakeLockHandle {
  releaseCalls = 0;
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'release', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'release', listener: () => void): void {
    this.listeners.delete(listener);
  }

  release(): Promise<void> {
    this.releaseCalls += 1;
    for (const listener of [...this.listeners]) listener();
    return Promise.resolve();
  }

  fire(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function installWakeLock(request: (() => Promise<WakeLockHandle>) | undefined): void {
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: request ? { request } : undefined,
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function Probe({ running }: { running: boolean }) {
  useWakeLock(running);
  return <button type="button" data-testid="plus">+</button>;
}

describe('stay-awake video element', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('is muted, inline, looping, and still in the layout', () => {
    const video = createStayAwakeVideo(withBase(STAY_AWAKE_FILE));
    video.prepare();
    const node = document.querySelector('video');
    expect(node).toBeInstanceOf(HTMLVideoElement);
    if (!(node instanceof HTMLVideoElement)) return;
    expect(node.muted).toBe(true);
    expect(node.loop).toBe(true);
    expect(node.playsInline).toBe(true);
    expect(node.getAttribute('playsinline')).toBe('');
    expect(node.getAttribute('webkit-playsinline')).toBe('true');
    expect(node.getAttribute('aria-hidden')).toBe('true');
    expect(node.controls).toBe(false);
    expect(node.style.display).toBe('');
    expect(node.style.cssText.toLowerCase()).not.toContain('display');
    expect(node.style.position).toBe('fixed');
    expect(node.style.opacity).toBe('0');
    expect(node.style.width).toBe('1px');
    expect(node.style.height).toBe('1px');
    expect(node.style.pointerEvents).toBe('none');
    expect(node.getAttribute('src') ?? node.src).toContain(STAY_AWAKE_FILE);
    expect(node.src).not.toContain('blob:');
    expect(node.src).not.toContain('data:');
    video.destroy();
    expect(document.querySelector('video')).toBeNull();
  });
});

describe('useWakeLock', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

  afterEach(async () => {
    for (const view of mounted.splice(0)) {
      await act(async () => {
        view.root.unmount();
      });
      view.container.remove();
    }
    installWakeLock(undefined);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.body.replaceChildren();
  });

  async function mount(running: boolean): Promise<HTMLDivElement> {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe running={running} />);
    });
    mounted.push({ root, container });
    return container;
  }

  it('acquires on pointerdown after a gesture-less request is refused', async () => {
    const sentinels: FakeSentinel[] = [];
    let calls = 0;
    installWakeLock(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('NotAllowedError'));
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    });
    const container = await mount(true);
    await flush();
    expect(calls).toBe(1);
    expect(sentinels).toHaveLength(0);
    const plus = container.querySelector('[data-testid="plus"]');
    expect(plus).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      plus?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    await flush();
    expect(calls).toBe(2);
    expect(sentinels[0]?.releaseCalls).toBe(0);
  });

  it('reacquires after release and after the page is visible again', async () => {
    const sentinels: FakeSentinel[] = [];
    installWakeLock(async () => {
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    await mount(true);
    await flush();
    expect(sentinels).toHaveLength(1);
    await act(async () => {
      sentinels[0]?.fire();
    });
    await flush();
    expect(sentinels).toHaveLength(2);

    let visible = false;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden'),
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(sentinels[1]?.releaseCalls).toBe(1);
    visible = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(sentinels).toHaveLength(3);
    expect(sentinels[2]?.releaseCalls).toBe(0);
  });

  it('releases the lock when the match stops running', async () => {
    const sentinels: FakeSentinel[] = [];
    installWakeLock(async () => {
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    const container = await mount(true);
    await flush();
    const root = mounted[0]?.root;
    await act(async () => {
      root?.render(<Probe running={false} />);
    });
    await flush();
    expect(sentinels[0]?.releaseCalls).toBe(1);
    expect(container.querySelector('video')).toBeNull();
  });

  it('does not play the fallback until a tap when wake lock is missing', async () => {
    installWakeLock(undefined);
    let plays = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = () => {
      plays += 1;
      return Promise.resolve();
    };
    try {
      await mount(true);
      await flush();
      const waiting = document.querySelector('video');
      expect(waiting).toBeInstanceOf(HTMLVideoElement);
      if (!(waiting instanceof HTMLVideoElement)) return;
      expect(waiting.paused).toBe(true);
      expect(plays).toBe(0);
      expect(waiting.src).toContain(STAY_AWAKE_FILE);
      await act(async () => {
        document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      });
      await flush();
      expect(plays).toBe(1);
      const node = document.querySelector('video');
      expect(node).toBeInstanceOf(HTMLVideoElement);
      if (!(node instanceof HTMLVideoElement)) return;
      expect(node.muted).toBe(true);
      expect(node.playsInline).toBe(true);
      expect(node.style.display).toBe('');
      expect(node.src).not.toContain('blob:');
    } finally {
      HTMLMediaElement.prototype.play = play;
    }
  });

  it.each(['pointerup', 'click'] as const)('starts the fallback from %s when wake lock is missing', async (type) => {
    installWakeLock(undefined);
    let plays = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = () => {
      plays += 1;
      return Promise.resolve();
    };
    try {
      await mount(true);
      await flush();
      expect(plays).toBe(0);
      await act(async () => {
        const event = type === 'click' ? new MouseEvent(type, { bubbles: true }) : new PointerEvent(type, { bubbles: true });
        document.dispatchEvent(event);
      });
      await flush();
      expect(plays).toBe(1);
    } finally {
      HTMLMediaElement.prototype.play = play;
    }
  });
});

describe('court screen lock', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

  afterEach(async () => {
    for (const view of mounted.splice(0)) {
      await act(async () => {
        view.root.unmount();
      });
      view.container.remove();
    }
    installWakeLock(undefined);
    localStorage.clear();
  });

  async function click(testId: string): Promise<void> {
    const node = document.querySelector(`[data-testid="${testId}"]`);
    if (!(node instanceof HTMLButtonElement)) throw new Error(`missing button ${testId}`);
    await act(async () => {
      node.click();
    });
  }

  it('releases the screen lock when the match ends', async () => {
    const sentinels: FakeSentinel[] = [];
    installWakeLock(async () => {
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    mounted.push({ root, container });
    await flush();
    expect(sentinels).toHaveLength(1);

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="menu-toggle"]');
    if (toggle) await click('menu-toggle');
    await click('end-match');
    await click('confirm-end');
    await flush();
    expect(document.querySelector('[data-testid="match-result"]')?.textContent).toContain('Draw');
    expect(sentinels[0]?.releaseCalls).toBe(1);

    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    await flush();
    expect(sentinels).toHaveLength(1);
  });
});
