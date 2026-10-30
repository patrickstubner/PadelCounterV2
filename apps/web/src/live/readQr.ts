interface QrHit {
  readonly rawValue?: string;
}

interface QrDetector {
  detect(source: CanvasImageSource): Promise<readonly QrHit[]>;
}

interface BarcodeDetectorHost {
  BarcodeDetector?: new (options: { formats: readonly string[] }) => QrDetector;
}

interface QrDecode {
  (
    image: { data: Uint8ClampedArray; width: number; height: number },
    options: { effort: number; timeLimit: number; nativeLimit: number },
  ): string;
}

interface DecodeAttempt {
  cancelled: boolean;
}

type Sample = (coverage: number, edge: number) => ImageData | null;

interface DecodeStep {
  readonly coverage: number;
  readonly edge: number;
  readonly prepare: 'raw' | 'stretch' | 'glare' | 'invert';
  readonly effort: number;
}

/**
 * One camera frame may spend about this long on crops and preparations.
 * A hit returns immediately. A glowing screen needs the later preparations,
 * so the budget is long enough for them on a phone and still bounded.
 */
export const FRAME_BUDGET_MS = 240;

/**
 * A detect or decode that never settles must not leave the scanner locked.
 * This is longer than the frame budget so one sync decode can finish.
 */
export const DECODE_WAIT_MS = 1_000;

/** Joined text longer than this is not a join link. `tokenFromJoinQr` uses the same cap. */
const MAX_TEXT = 2048;

const MAX_SIDE = 4096;

/**
 * Order is the usual camera frame first, then exposure, glare, a tight crop, a
 * smaller image for blur, and an inverted pass for a reflection.
 */
const STEPS: readonly DecodeStep[] = [
  { coverage: 1, edge: 640, prepare: 'raw', effort: 2 },
  { coverage: 1, edge: 640, prepare: 'stretch', effort: 3 },
  { coverage: 1, edge: 640, prepare: 'glare', effort: 3 },
  { coverage: 0.55, edge: 640, prepare: 'stretch', effort: 3 },
  { coverage: 1, edge: 420, prepare: 'stretch', effort: 2 },
  { coverage: 1, edge: 640, prepare: 'invert', effort: 2 },
];

let cachedDetector: QrDetector | null = null;

/**
 * True while a frame is being read.
 * The sync `qr` decoder does not reject a second call.
 * The wait below clears the lock if that frame never settles.
 */
let decodeBusy = false;

let scratch: HTMLCanvasElement | null = null;

function nativeDetector(): QrDetector | null {
  if (cachedDetector) return cachedDetector;
  const host = globalThis as BarcodeDetectorHost;
  if (typeof host.BarcodeDetector !== 'function') return null;
  cachedDetector = new host.BarcodeDetector({ formats: ['qr_code'] });
  return cachedDetector;
}

function asImage(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function supported(image: ImageData): boolean {
  if (image.width < 8 || image.height < 8) return false;
  if (image.width > MAX_SIDE || image.height > MAX_SIDE) return false;
  return image.data.length >= image.width * image.height * 4;
}

function lumaAt(data: Uint8ClampedArray, offset: number): number {
  const red = data[offset] ?? 0;
  const green = data[offset + 1] ?? 0;
  const blue = data[offset + 2] ?? 0;
  return (red * 54 + green * 183 + blue * 19) >> 8;
}

function channel(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, band: number): number {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
  return data[(cy * width + cx) * 4 + band] ?? 0;
}

/** Centre square, scaled with bilinear filtering. `coverage` 1 is the full square. */
export function sampleSquare(image: ImageData, edge: number, coverage: number): ImageData | null {
  if (!supported(image) || edge < 8) return null;
  const side = Math.min(image.width, image.height);
  const span = Math.max(8, Math.min(side, Math.round(side * coverage)));
  if (coverage >= 0.999 && image.width === edge && image.height === edge) return image;
  const x0 = (image.width - span) / 2;
  const y0 = (image.height - span) / 2;
  const data = new Uint8ClampedArray(edge * edge * 4);
  for (let y = 0; y < edge; y += 1) {
    const gy = y0 + ((y + 0.5) * span) / edge - 0.5;
    const y1 = Math.floor(gy);
    const fy = gy - y1;
    for (let x = 0; x < edge; x += 1) {
      const gx = x0 + ((x + 0.5) * span) / edge - 0.5;
      const x1 = Math.floor(gx);
      const fx = gx - x1;
      const to = (y * edge + x) * 4;
      for (let band = 0; band < 3; band += 1) {
        const a = channel(image.data, image.width, image.height, x1, y1, band);
        const b = channel(image.data, image.width, image.height, x1 + 1, y1, band);
        const c = channel(image.data, image.width, image.height, x1, y1 + 1, band);
        const d = channel(image.data, image.width, image.height, x1 + 1, y1 + 1, band);
        const top = a + (b - a) * fx;
        const bottom = c + (d - c) * fx;
        data[to + band] = Math.max(0, Math.min(255, Math.round(top + (bottom - top) * fy)));
      }
      data[to + 3] = 255;
    }
  }
  return asImage(data, edge, edge);
}

function grayFrom(image: ImageData, map: (value: number) => number): ImageData {
  const count = image.width * image.height;
  const data = new Uint8ClampedArray(count * 4);
  for (let index = 0; index < count; index += 1) {
    const value = Math.max(0, Math.min(255, map(lumaAt(image.data, index * 4))));
    const to = index * 4;
    data[to] = value;
    data[to + 1] = value;
    data[to + 2] = value;
    data[to + 3] = 255;
  }
  return asImage(data, image.width, image.height);
}

function histogram(image: ImageData): Uint32Array {
  const bins = new Uint32Array(256);
  const count = image.width * image.height;
  for (let index = 0; index < count; index += 1) {
    const slot = lumaAt(image.data, index * 4);
    bins[slot] = (bins[slot] ?? 0) + 1;
  }
  return bins;
}

function percentile(bins: Uint32Array, count: number, fraction: number): number {
  const target = Math.max(1, Math.floor(count * fraction));
  let seen = 0;
  for (let value = 0; value < 256; value += 1) {
    seen += bins[value] ?? 0;
    if (seen >= target) return value;
  }
  return 255;
}

/** Stretch the useful gray range so a dim or blown-out screen still has black and white. */
export function stretchContrast(image: ImageData): ImageData {
  const count = image.width * image.height;
  const bins = histogram(image);
  const low = percentile(bins, count, 0.02);
  const high = percentile(bins, count, 0.98);
  if (high - low < 12) return grayFrom(image, (value) => value);
  const scale = 255 / (high - low);
  return grayFrom(image, (value) => (value - low) * scale);
}

/**
 * Pull specular highlights down to the bright end of the code, then stretch.
 * A lamp reflection on a phone screen is a white blob, not a module.
 */
export function flattenGlare(image: ImageData): ImageData {
  const count = image.width * image.height;
  const cap = percentile(histogram(image), count, 0.9);
  const clipped = grayFrom(image, (value) => (value > cap ? cap : value));
  return stretchContrast(clipped);
}

export function invertImage(image: ImageData): ImageData {
  return grayFrom(image, (value) => 255 - value);
}

function prepare(image: ImageData, kind: DecodeStep['prepare']): ImageData {
  if (kind === 'stretch') return stretchContrast(image);
  if (kind === 'glare') return flattenGlare(image);
  if (kind === 'invert') return invertImage(stretchContrast(image));
  return image;
}

function readDecoded(decodeQR: QrDecode, image: ImageData, effort: number, timeLimit: number): string | null {
  try {
    const text = decodeQR(
      { data: image.data, width: image.width, height: image.height },
      { effort, timeLimit, nativeLimit: 720 },
    );
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TEXT) return null;
    return trimmed;
  } catch {
    return null;
  }
}

function budgetLeft(started: number): number {
  return FRAME_BUDGET_MS - (Date.now() - started);
}

function cachedSample(sample: Sample): Sample {
  const cache = new Map<string, ImageData | null>();
  return (coverage, edge) => {
    const key = `${coverage}:${edge}`;
    const found = cache.get(key);
    if (found !== undefined) return found;
    const image = sample(coverage, edge);
    cache.set(key, image);
    return image;
  };
}

/** Resolves with null if `work` does not settle in time. `work` itself is left running. */
function settleWithin<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      onTimeout();
      resolve(null);
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function loadDecoder(): Promise<QrDecode> {
  const imported = await import('qr/decode.js');
  return imported.default as QrDecode;
}

async function decodeSamples(sample: Sample, attempt: DecodeAttempt): Promise<string | null> {
  const take = cachedSample(sample);
  const decodeQR = await loadDecoder();
  if (attempt.cancelled) return null;
  const started = Date.now();
  for (const step of STEPS) {
    const remaining = budgetLeft(started);
    if (attempt.cancelled || remaining <= 8) return null;
    const cropped = take(step.coverage, step.edge);
    if (!cropped) continue;
    const text = readDecoded(decodeQR, prepare(cropped, step.prepare), step.effort, remaining);
    if (text) return text;
  }
  return null;
}

function frameCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!scratch) scratch = document.createElement('canvas');
  return scratch;
}

function grabSquare(video: HTMLVideoElement, edge: number, coverage: number): ImageData | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width < 8 || height < 8) return null;
  const side = Math.min(width, height);
  const span = Math.max(8, Math.min(side, Math.round(side * coverage)));
  const canvas = frameCanvas();
  const context = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !context) return null;
  canvas.width = edge;
  canvas.height = edge;
  context.imageSmoothingEnabled = span !== edge;
  context.drawImage(video, (width - span) / 2, (height - span) / 2, span, span, 0, 0, edge, edge);
  return context.getImageData(0, 0, edge, edge);
}

async function nativeValue(detect: () => Promise<readonly QrHit[]>, attempt: DecodeAttempt): Promise<string | null> {
  if (attempt.cancelled) return null;
  try {
    const codes = await detect();
    if (attempt.cancelled) return null;
    const value = codes[0]?.rawValue;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TEXT) return null;
    return trimmed;
  } catch {
    return null;
  }
}

async function readImage(image: ImageData, attempt: DecodeAttempt): Promise<string | null> {
  const native = nativeDetector();
  if (native && !attempt.cancelled && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(image);
      try {
        const text = await nativeValue(() => native.detect(bitmap), attempt);
        if (text) return text;
      } finally {
        if (typeof bitmap.close === 'function') bitmap.close();
      }
    } catch {
      // Native detection failed. The software decoder follows.
    }
  }
  if (attempt.cancelled) return null;
  return decodeSamples((coverage, edge) => sampleSquare(image, edge, coverage), attempt);
}

async function readVideo(video: HTMLVideoElement, attempt: DecodeAttempt): Promise<string | null> {
  const native = nativeDetector();
  if (native && video.readyState >= 2 && !attempt.cancelled) {
    const text = await nativeValue(() => native.detect(video), attempt);
    if (text) return text;
  }
  if (attempt.cancelled || video.videoWidth < 8 || video.videoHeight < 8) return null;
  return decodeSamples((coverage, edge) => grabSquare(video, edge, coverage), attempt);
}

function readLocked(work: (attempt: DecodeAttempt) => Promise<string | null>): Promise<string | null> {
  if (decodeBusy) return Promise.resolve(null);
  const attempt: DecodeAttempt = { cancelled: false };
  decodeBusy = true;
  return settleWithin(work(attempt), DECODE_WAIT_MS, () => {
    attempt.cancelled = true;
    decodeBusy = false;
  }).finally(() => {
    if (!attempt.cancelled) decodeBusy = false;
  });
}

/**
 * Native BarcodeDetector when this browser has one and it returns a code.
 * Otherwise the pinned `qr` decoder, on a centre crop with contrast, glare, and invert passes.
 * iOS Safari has no working BarcodeDetector, so the software path is the one that joins.
 */
export async function readQrImage(image: ImageData): Promise<string | null> {
  if (!supported(image)) return null;
  return readLocked((attempt) => readImage(image, attempt));
}

export async function readQrVideo(video: HTMLVideoElement): Promise<string | null> {
  return readLocked((attempt) => readVideo(video, attempt));
}
