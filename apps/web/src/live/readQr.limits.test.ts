import { describe, expect, it, vi } from 'vitest';

const decoded = vi.hoisted(() => ({ text: '' }));

vi.mock('qr/decode.js', () => ({
  default: () => {
    if (decoded.text.length === 0) throw new Error('miss');
    return decoded.text;
  },
}));

import { readQrImage } from './readQr';

function blank(): ImageData {
  const width = 32;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('decoder text length', () => {
  it('keeps 2048 characters and drops 2049', async () => {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    decoded.text = 'a'.repeat(2048);
    expect(await readQrImage(blank())).toBe(decoded.text);
    decoded.text = 'a'.repeat(2049);
    expect(await readQrImage(blank())).toBeNull();
  });
});
