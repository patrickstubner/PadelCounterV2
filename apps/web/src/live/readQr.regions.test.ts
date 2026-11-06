import { create } from 'qrcode';
import { describe, expect, it } from 'vitest';
import { readQrImage } from './readQr';

const PAYLOAD = 'https://patrickstubner.github.io/PadelCounterV2/#/join?t=abcdefghijklmnopqrstuv';

function blank(width: number, height: number, fill = 255): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = fill;
    data[index + 1] = fill;
    data[index + 2] = fill;
    data[index + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function paint(
  target: ImageData,
  scale: number,
  originX: number,
  originY: number,
  dark: number,
  light: number,
  level: 'M' | 'H' = 'M',
): void {
  const qr = create(PAYLOAD, { errorCorrectionLevel: level });
  const size = qr.modules.size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = qr.modules.get(y, x) ? dark : light;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = originX + x * scale + dx;
          const py = originY + y * scale + dy;
          if (px < 0 || py < 0 || px >= target.width || py >= target.height) continue;
          const offset = (py * target.width + px) * 4;
          target.data[offset] = color;
          target.data[offset + 1] = color;
          target.data[offset + 2] = color;
        }
      }
    }
  }
}

describe('codes outside the centre square', () => {
  it('reads a code at the top of a tall frame', async () => {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    const frame = blank(120, 280);
    paint(frame, 2, 23, 4, 0, 255);
    expect(await readQrImage(frame)).toBe(PAYLOAD);
  });

  it('reads a code at the bottom of a tall frame', async () => {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    const frame = blank(120, 280);
    paint(frame, 2, 23, 202, 0, 255);
    expect(await readQrImage(frame)).toBe(PAYLOAD);
  });

  it('reads a flat low-contrast code that needs the glare pass', async () => {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    const frame = blank(280, 280, 208);
    paint(frame, 5, 20, 20, 200, 208, 'M');
    expect(await readQrImage(frame)).toBe(PAYLOAD);
  });
});
