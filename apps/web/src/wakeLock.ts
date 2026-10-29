export interface WakeLockHandle {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

export interface StayAwakeVideo {
  /** Buffer the fallback. Must not start playback. */
  prepare(): void;
  /**
   * Start playback. Callers invoke this synchronously from a user gesture so
   * iOS still counts the tap.
   */
  play(): Promise<void>;
  pause(): void;
}

export interface StayAwakeHost {
  /** Null when `navigator.wakeLock` is missing. Rejects when the request is refused. */
  readonly requestWakeLock: (() => Promise<WakeLockHandle>) | null;
  readonly video: StayAwakeVideo;
  isVisible(): boolean;
}

export type StayAwakeMode = 'off' | 'wake-lock' | 'video';

export interface StayAwake {
  setRunning(running: boolean): void;
  onGesture(): void;
  onVisibility(): void;
  dispose(): void;
  readonly mode: StayAwakeMode;
}

/** How many times a visible page may ask again after the browser drops the lock. */
const RELEASE_REARM_LIMIT = 2;

interface BrowserWakeLock {
  request(type: 'screen'): Promise<WakeLockHandle>;
}

/** The platform request, or null when this browser has no Screen Wake Lock. */
export function screenWakeLockRequest(): (() => Promise<WakeLockHandle>) | null {
  const nav = globalThis.navigator as (Navigator & { wakeLock?: BrowserWakeLock }) | undefined;
  const wakeLock = nav?.wakeLock;
  if (!wakeLock || typeof wakeLock.request !== 'function') return null;
  return () => wakeLock.request('screen');
}

/** Ask the screen to stay on. A missing API and a refused request resolve to null. */
export async function acquireScreenWakeLock(
  request?: () => Promise<WakeLockHandle>,
): Promise<WakeLockHandle | null> {
  const fn = request ?? screenWakeLockRequest();
  if (!fn) return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * Hold the screen awake while a match is running.
 * The lock is dropped when the match ends or the page is hidden.
 * A later visit, and the next pointer gesture, ask again.
 * The looping video starts only from that gesture, and only when the lock is missing.
 */
export function createStayAwake(host: StayAwakeHost): StayAwake {
  let running = false;
  let disposed = false;
  let mode: StayAwakeMode = 'off';
  let generation = 0;
  let pending = false;
  let releaseArms = 0;
  let sentinel: WakeLockHandle | null = null;
  let removeRelease: (() => void) | null = null;

  const shouldHold = (): boolean => running && !disposed && host.isVisible();

  const stopVideo = (): void => {
    host.video.pause();
    if (mode === 'video') mode = 'off';
  };

  const releaseHold = (): void => {
    generation += 1;
    const current = sentinel;
    const remove = removeRelease;
    sentinel = null;
    removeRelease = null;
    if (mode === 'wake-lock') mode = 'off';
    stopVideo();
    remove?.();
    if (!current) return;
    void current.release().catch(() => undefined);
  };

  const attach = (next: WakeLockHandle): void => {
    const onRelease = (): void => {
      next.removeEventListener('release', onRelease);
      if (removeRelease === remove) removeRelease = null;
      if (sentinel !== next) return;
      sentinel = null;
      if (mode === 'wake-lock') mode = 'off';
      if (!shouldHold() || releaseArms >= RELEASE_REARM_LIMIT) return;
      releaseArms += 1;
      void armWakeLock();
    };
    const remove = (): void => {
      next.removeEventListener('release', onRelease);
    };
    sentinel = next;
    removeRelease = remove;
    mode = 'wake-lock';
    next.addEventListener('release', onRelease);
    stopVideo();
  };

  async function armWakeLock(): Promise<void> {
    const request = host.requestWakeLock;
    if (!shouldHold() || sentinel || pending) return;
    if (!request) {
      host.video.prepare();
      return;
    }
    pending = true;
    const token = generation;
    let next: WakeLockHandle;
    try {
      next = await request();
    } catch {
      pending = false;
      if (token === generation && shouldHold()) host.video.prepare();
      return;
    }
    pending = false;
    if (token !== generation || !shouldHold() || sentinel) {
      await next.release().catch(() => undefined);
      return;
    }
    attach(next);
  }

  const startFallback = (): void => {
    let played: Promise<void>;
    try {
      played = host.video.play();
    } catch {
      return;
    }
    void played.then(
      () => {
        if (sentinel || !shouldHold()) {
          host.video.pause();
          return;
        }
        mode = 'video';
      },
      () => undefined,
    );
  };

  return {
    get mode() {
      return mode;
    },
    setRunning(next: boolean): void {
      running = next;
      if (!shouldHold()) {
        releaseHold();
        return;
      }
      releaseArms = 0;
      void armWakeLock();
    },
    onGesture(): void {
      if (!shouldHold() || sentinel) return;
      releaseArms = 0;
      startFallback();
      void armWakeLock();
    },
    onVisibility(): void {
      if (!shouldHold()) {
        releaseHold();
        return;
      }
      releaseArms = 0;
      void armWakeLock();
    },
    dispose(): void {
      disposed = true;
      releaseHold();
    },
  };
}
