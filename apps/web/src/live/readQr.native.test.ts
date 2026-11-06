import { create } from 'qrcode';
import { afterEach, describe, expect, it } from 'vitest';
import { readQrImage } from './readQr';

const PAYLOAD = 'https://patrickstubner.github.io/PadelCounterV2/#/join?t=abcdefghijklmnopqrstuv';

function cleanCode(): ImageData {
  const qr = create(PAYLOAD, { errorCorrectionLevel: 'M' });
  const scale = 6;
  const quiet = 4;
  const span = (qr.modules.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(span * span * 4);
  data.fill(255);
  for (let y = 0; y < qr.modules.size; y += 1) {
    for (let x = 0; x < qr.modules.size; x += 1) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const offset = (py * span + px) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
        }
      }
    }
  }
  return { data, width: span, height: span, colorSpace: 'srgb' } as ImageData;
}

describe('BarcodeDetector miss', () => {
  const previousBitmap = globalThis.createImageBitmap;

  afterEach(() => {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    globalThis.createImageBitmap = previousBitmap;
  });

  it('reads the code in software when the native detector returns nothing', async () => {
    globalThis.createImageBitmap = async () => ({ close() {} }) as ImageBitmap;
    class EmptyDetector {
      detect(): Promise<readonly { rawValue?: string }[]> {
        return Promise.resolve([]);
      }
    }
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = EmptyDetector;
    expect(await readQrImage(cleanCode())).toBe(PAYLOAD);
  });

  it('does not accept a native value longer than 2048 characters', async () => {
    globalThis.createImageBitmap = async () => ({ close() {} }) as ImageBitmap;
    class LongDetector {
      detect(): Promise<readonly { rawValue: string }[]> {
        return Promise.resolve([{ rawValue: 'n'.repeat(2049) }]);
      }
    }
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = LongDetector;
    const text = await readQrImage(cleanCode());
    expect(text === null || text === PAYLOAD).toBe(true);
    expect(text ?? '').not.toContain('nnnn');
    expect((text ?? '').length).toBeLessThanOrEqual(2048);
  });
});
