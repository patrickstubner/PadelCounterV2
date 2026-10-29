import { encodeQR } from 'qr';
import { describe, expect, it } from 'vitest';
import { readQrImage } from './readQr';

const PAYLOAD = 'https://patrickstubner.github.io/PadelCounterV2/#/join?t=abcdefghijklmnopqrstuv';

function imageOf(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

/** A camera-sized frame with a QR in the middle. `true` modules from `qr` are black. */
function frameWithQr(payload: string): ImageData {
  const modules = encodeQR(payload, 'raw', { ecc: 'medium', scale: 10, border: 4 });
  const height = 1080;
  const width = 1920;
  const image = imageOf(width, height);
  const codeHeight = modules.length;
  const codeWidth = modules[0]?.length ?? 0;
  const y0 = Math.floor((height - codeHeight) / 2);
  const x0 = Math.floor((width - codeWidth) / 2);
  for (let y = 0; y < codeHeight; y += 1) {
    const row = modules[y];
    if (!row) continue;
    for (let x = 0; x < codeWidth; x += 1) {
      if (!row[x]) continue;
      const index = ((y0 + y) * width + (x0 + x)) * 4;
      image.data[index] = 0;
      image.data[index + 1] = 0;
      image.data[index + 2] = 0;
    }
  }
  return image;
}

describe('software QR fallback', () => {
  it('reads a centred code from a large camera frame and ignores an overlapping decode', async () => {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    const frame = frameWithQr(PAYLOAD);
    expect(frame.width).toBe(1920);
    expect(frame.height).toBe(1080);
    const first = readQrImage(frame);
    const second = readQrImage(frame);
    expect(await second).toBeNull();
    expect(await first).toBe(PAYLOAD);
    expect(await readQrImage(imageOf(64, 64))).toBeNull();
  });
});
