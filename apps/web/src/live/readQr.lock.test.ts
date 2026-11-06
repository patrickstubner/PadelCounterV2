import { afterEach, describe, expect, it, vi } from 'vitest';

describe('decode lock', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    vi.resetModules();
  });

  it('settles and unlocks when detection never returns', async () => {
    vi.useFakeTimers();
    (globalThis as { BarcodeDetector?: new () => { detect: () => Promise<never> } }).BarcodeDetector = class {
      detect(): Promise<never> {
        return new Promise(() => undefined);
      }
    };
    const { DECODE_WAIT_MS, readQrVideo } = await import('./readQr');
    const video = { readyState: 2, videoWidth: 320, videoHeight: 240 } as HTMLVideoElement;
    const first = readQrVideo(video);
    await vi.advanceTimersByTimeAsync(DECODE_WAIT_MS);
    expect(await first).toBeNull();

    const second = readQrVideo(video);
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(DECODE_WAIT_MS);
    expect(await second).toBeNull();
  });
});
