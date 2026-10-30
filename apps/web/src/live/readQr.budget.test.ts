import { afterEach, describe, expect, it, vi } from 'vitest';
import { readQrImage } from './readQr';

const clock = vi.hoisted(() => ({ now: 1_000, attempts: 0 }));

vi.mock('qr/decode.js', () => ({
  default: () => {
    clock.attempts += 1;
    clock.now += 400;
    throw new Error('finder');
  },
}));

function blankFrame(): ImageData {
  const width = 1920;
  const height = 1080;
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
}

describe('one time budget per frame', () => {
  afterEach(() => {
    clock.now = 1_000;
    clock.attempts = 0;
    vi.restoreAllMocks();
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  });

  it('skips the remaining preparations once the frame budget is spent', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
    const frame = blankFrame();
    frame.data.fill(255);
    expect(await readQrImage(frame)).toBeNull();
    expect(clock.attempts).toBe(1);
  });
});
