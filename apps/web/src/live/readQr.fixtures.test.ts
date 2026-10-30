import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePngRgba } from './pngRgba';
import { readQrImage } from './readQr';

const PAYLOAD = 'https://patrickstubner.github.io/PadelCounterV2/#/join?t=abcdefghijklmnopqrstuv';
const FIXTURES = ['skewed', 'blurred', 'small', 'bright', 'dark', 'glare'] as const;
const directory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function load(name: string): Promise<ImageData> {
  const png = await decodePngRgba(readFileSync(join(directory, `${name}.png`)));
  return { data: png.data, width: png.width, height: png.height, colorSpace: 'srgb' } as ImageData;
}

describe('photos of a display', () => {
  it.each(FIXTURES)('reads a %s screen', async (name) => {
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    const image = await load(name);
    expect(image.width).toBeGreaterThanOrEqual(480);
    expect(image.height).toBeGreaterThanOrEqual(360);
    let midGray = 0;
    for (let index = 0; index < image.data.length; index += 4) {
      const value = image.data[index] ?? 0;
      if (value > 12 && value < 243) midGray += 1;
    }
    expect(midGray).toBeGreaterThan(50);
    expect(await readQrImage(image)).toBe(PAYLOAD);
  });
});
