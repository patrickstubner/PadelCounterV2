import { describe, expect, it } from 'vitest';
import {
  acquireScreenWakeLock,
  createStayAwake,
  type StayAwake,
  type StayAwakeVideo,
  type WakeLockHandle,
} from './wakeLock';

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
    this.fire();
    return Promise.resolve();
  }

  /** Browser dropped the lock without the page calling release. */
  fire(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeVideo implements StayAwakeVideo {
  prepared = false;
  playCalls = 0;
  pauseCalls = 0;
  playing = false;
  failPlay = false;

  prepare(): void {
    this.prepared = true;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    if (this.failPlay) return Promise.reject(new Error('play refused'));
    this.playing = true;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.playing = false;
  }
}

function harness(request: (() => Promise<WakeLockHandle>) | null): {
  stay: StayAwake;
  video: FakeVideo;
  setVisible: (visible: boolean) => void;
} {
  let visible = true;
  const video = new FakeVideo();
  const stay = createStayAwake({
    requestWakeLock: request,
    video,
    isVisible: () => visible,
  });
  return {
    stay,
    video,
    setVisible: (next: boolean) => {
      visible = next;
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('acquireScreenWakeLock', () => {
  it('returns null when the API is absent', async () => {
    expect(await acquireScreenWakeLock(undefined)).toBeNull();
  });

  it('returns null when the request fails', async () => {
    const result = await acquireScreenWakeLock(() => Promise.reject(new Error('not allowed')));
    expect(result).toBeNull();
  });

  it('returns the sentinel when the request succeeds', async () => {
    let released = false;
    const handle = await acquireScreenWakeLock(async () => ({
      release: async () => {
        released = true;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    expect(handle).not.toBeNull();
    await handle?.release();
    expect(released).toBe(true);
  });
});

describe('stay awake', () => {
  it('acquires on a user gesture when the first request was refused', async () => {
    const order: string[] = [];
    let resolveGesture: (handle: WakeLockHandle) => void = () => undefined;
    let calls = 0;
    const { stay, video } = harness(() => {
      calls += 1;
      if (calls === 1) {
        order.push('mount-request');
        return Promise.reject(new Error('NotAllowedError'));
      }
      order.push('gesture-request');
      return new Promise<WakeLockHandle>((resolve) => {
        resolveGesture = (handle) => {
          resolve(handle);
        };
      });
    });

    stay.setRunning(true);
    await flush();
    expect(stay.mode).toBe('off');
    expect(video.playCalls).toBe(0);
    expect(video.prepared).toBe(true);

    stay.onGesture();
    expect(order).toEqual(['mount-request', 'gesture-request']);
    expect(video.playCalls).toBe(1);
    expect(video.playing).toBe(true);

    const sentinel = new FakeSentinel();
    resolveGesture(sentinel);
    await flush();
    expect(stay.mode).toBe('wake-lock');
    expect(video.playing).toBe(false);
    expect(sentinel.releaseCalls).toBe(0);
  });

  it('does not start the video when the lock is acquired without a gesture', async () => {
    const sentinel = new FakeSentinel();
    const { stay, video } = harness(async () => sentinel);
    stay.setRunning(true);
    await flush();
    expect(stay.mode).toBe('wake-lock');
    expect(video.playCalls).toBe(0);
    stay.onGesture();
    expect(video.playCalls).toBe(0);
    expect(sentinel.releaseCalls).toBe(0);
  });

  it('reacquires after the sentinel fires release while the page is visible', async () => {
    const sentinels: FakeSentinel[] = [];
    const { stay } = harness(async () => {
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    stay.setRunning(true);
    await flush();
    expect(sentinels).toHaveLength(1);
    sentinels[0]?.fire();
    await flush();
    expect(sentinels).toHaveLength(2);
    expect(stay.mode).toBe('wake-lock');
    expect(sentinels[0]?.releaseCalls).toBe(0);
    expect(sentinels[1]?.releaseCalls).toBe(0);
  });

  it('releases when the page is hidden and reacquires when it is visible again', async () => {
    const sentinels: FakeSentinel[] = [];
    const { stay, video, setVisible } = harness(async () => {
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    stay.setRunning(true);
    await flush();
    setVisible(false);
    stay.onVisibility();
    await flush();
    expect(sentinels[0]?.releaseCalls).toBe(1);
    expect(stay.mode).toBe('off');
    expect(sentinels).toHaveLength(1);

    setVisible(true);
    stay.onVisibility();
    await flush();
    expect(sentinels).toHaveLength(2);
    expect(stay.mode).toBe('wake-lock');
    expect(video.playCalls).toBe(0);
  });

  it('releases when the match ends and does not ask again', async () => {
    const sentinels: FakeSentinel[] = [];
    const { stay, video } = harness(async () => {
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    stay.setRunning(true);
    await flush();
    stay.setRunning(false);
    await flush();
    expect(sentinels[0]?.releaseCalls).toBe(1);
    expect(sentinels).toHaveLength(1);
    expect(stay.mode).toBe('off');
    stay.onGesture();
    expect(video.playCalls).toBe(0);
    expect(sentinels).toHaveLength(1);
  });

  it('pauses the fallback when the page is hidden and when the match ends', async () => {
    const { stay, video, setVisible } = harness(null);
    stay.setRunning(true);
    await flush();
    stay.onGesture();
    await flush();
    expect(stay.mode).toBe('video');
    expect(video.playing).toBe(true);

    setVisible(false);
    stay.onVisibility();
    expect(video.playing).toBe(false);
    expect(stay.mode).toBe('off');

    setVisible(true);
    stay.onVisibility();
    await flush();
    expect(video.playCalls).toBe(1);
    stay.onGesture();
    await flush();
    expect(video.playing).toBe(true);

    stay.setRunning(false);
    expect(video.playing).toBe(false);
    expect(stay.mode).toBe('off');
  });

  it('plays the fallback on a gesture when wake lock is missing', async () => {
    const { stay, video } = harness(null);
    stay.setRunning(true);
    await flush();
    expect(video.playCalls).toBe(0);
    expect(video.prepared).toBe(true);
    stay.onGesture();
    expect(video.playCalls).toBe(1);
    await flush();
    expect(stay.mode).toBe('video');
    expect(video.playing).toBe(true);
  });

  it('plays the fallback on a gesture when every wake lock request is refused', async () => {
    let calls = 0;
    const { stay, video } = harness(() => {
      calls += 1;
      return Promise.reject(new Error('NotAllowedError'));
    });
    stay.setRunning(true);
    await flush();
    expect(calls).toBe(1);
    expect(video.playCalls).toBe(0);
    stay.onGesture();
    await flush();
    expect(calls).toBe(2);
    expect(video.playing).toBe(true);
    expect(stay.mode).toBe('video');
  });

  it('does not keep a refused video playing', async () => {
    const { stay, video } = harness(null);
    video.failPlay = true;
    stay.setRunning(true);
    stay.onGesture();
    await flush();
    expect(video.playCalls).toBe(1);
    expect(stay.mode).toBe('off');
  });

  it('drops an in-flight lock when the match ends before it arrives', async () => {
    let resolveRequest: (handle: WakeLockHandle) => void = () => undefined;
    const { stay } = harness(
      () =>
        new Promise<WakeLockHandle>((resolve) => {
          resolveRequest = (handle) => {
            resolve(handle);
          };
        }),
    );
    stay.setRunning(true);
    stay.setRunning(false);
    const late = new FakeSentinel();
    resolveRequest(late);
    await flush();
    expect(late.releaseCalls).toBe(1);
    expect(stay.mode).toBe('off');
  });
});
