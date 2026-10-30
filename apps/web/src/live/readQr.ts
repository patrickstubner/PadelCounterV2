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

type Region = 'center' | 'tight' | 'full' | 'top' | 'bottom';

interface DecodeStep {
  readonly region: Region;
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
 * A still photo tries every region. The long edge of the whole frame is about
 * 960, and the top and bottom squares cover a code the centre square misses.
 * Glare is its own pass: a bright spike must not be handled only by stretching.
 */
const STILL_STEPS: readonly DecodeStep[] = [
  { region: 'center', edge: 640, prepare: 'raw', effort: 2 },
  { region: 'center', edge: 640, prepare: 'glare', effort: 3 },
  { region: 'full', edge: 960, prepare: 'raw', effort: 2 },
  { region: 'top', edge: 640, prepare: 'raw', effort: 2 },
  { region: 'bottom', edge: 640, prepare: 'raw', effort: 2 },
  { region: 'center', edge: 640, prepare: 'stretch', effort: 3 },
  { region: 'tight', edge: 640, prepare: 'stretch', effort: 3 },
  { region: 'center', edge: 420, prepare: 'stretch', effort: 2 },
  { region: 'center', edge: 640, prepare: 'invert', effort: 2 },
];

/** Every camera attempt reads the centre, then one rotating heavier pass. */
const VIDEO_EXTRA: readonly DecodeStep[] = [
  { region: 'full', edge: 960, prepare: 'raw', effort: 2 },
  { region: 'top', edge: 640, prepare: 'raw', effort: 2 },
  { region: 'bottom', edge: 640, prepare: 'raw', effort: 2 },
  { region: 'center', edge: 640, prepare: 'glare', effort: 3 },
  { region: 'center', edge: 640, prepare: 'stretch', effort: 3 },
  { region: 'center', edge: 640, prepare: 'invert', effort: 2 },
  { region: 'tight', edge: 640, prepare: 'stretch', effort: 2 },
];

const CENTER_RAW: DecodeStep = { region: 'center', edge: 640, prepare: 'raw', effort: 2 };

let videoTurn = 0;

let cachedDetector: QrDetector | null = null;
let cachedDetectorCtor: BarcodeDetectorHost['BarcodeDetector'] | null = null;

/**
 * True while a frame is being read.
 * The sync `qr` decoder does not reject a second call.
 * The wait below clears the lock if that frame never settles.
 */
let decodeBusy = false;

let scratch: HTMLCanvasElement | null = null;

function nativeDetector(): QrDetector | null {
  const host = globalThis as BarcodeDetectorHost;
  if (typeof host.BarcodeDetector !== 'function') {
    cachedDetector = null;
    cachedDetectorCtor = null;
    return null;
  }
  if (cachedDetector && cachedDetectorCtor === host.BarcodeDetector) return cachedDetector;
  cachedDetectorCtor = host.BarcodeDetector;
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

/**
 * Remove a slow brightness ramp, such as a lamp across a phone screen.
 * The block is larger than a module, so the code stays and the ramp goes.
 */
export function evenLighting(image: ImageData): ImageData {
  const { width, height } = image;
  const count = width * height;
  const luma = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) luma[index] = lumaAt(image.data, index * 4);
  const block = 28;
  const columns = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const means = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0;
      let seen = 0;
      const y0 = row * block;
      const x0 = column * block;
      const y1 = Math.min(height, y0 + block);
      const x1 = Math.min(width, x0 + block);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += luma[y * width + x] ?? 0;
          seen += 1;
        }
      }
      means[row * columns + column] = seen > 0 ? sum / seen : 128;
    }
  }
  const data = new Uint8ClampedArray(count * 4);
  for (let y = 0; y < height; y += 1) {
    const gy = y / block - 0.5;
    const row0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
    const row1 = Math.max(0, Math.min(rows - 1, row0 + 1));
    const fy = Math.max(0, Math.min(1, gy - row0));
    for (let x = 0; x < width; x += 1) {
      const gx = x / block - 0.5;
      const column0 = Math.max(0, Math.min(columns - 1, Math.floor(gx)));
      const column1 = Math.max(0, Math.min(columns - 1, column0 + 1));
      const fx = Math.max(0, Math.min(1, gx - column0));
      const mean00 = means[row0 * columns + column0] ?? 128;
      const mean10 = means[row0 * columns + column1] ?? 128;
      const mean01 = means[row1 * columns + column0] ?? 128;
      const mean11 = means[row1 * columns + column1] ?? 128;
      const mean = mean00 * (1 - fx) * (1 - fy) + mean10 * fx * (1 - fy) + mean01 * (1 - fx) * fy + mean11 * fx * fy;
      const value = luma[y * width + x] ?? 0;
      const scaled = Math.max(0, Math.min(255, Math.round(128 + (value - mean) * 8)));
      const offset = (y * width + x) * 4;
      data[offset] = scaled;
      data[offset + 1] = scaled;
      data[offset + 2] = scaled;
      data[offset + 3] = 255;
    }
  }
  return stretchContrast(asImage(data, width, height));
}

function prepare(image: ImageData, kind: DecodeStep['prepare']): ImageData {
  if (kind === 'stretch') return stretchContrast(image);
  if (kind === 'glare') return evenLighting(flattenGlare(image));
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

interface SampleRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function regionRect(width: number, height: number, region: Region): SampleRect {
  if (region === 'full') return { x: 0, y: 0, width, height };
  const side = Math.min(width, height);
  const x = (width - side) / 2;
  if (region === 'top') return { x, y: 0, width: side, height: side };
  if (region === 'bottom') return { x, y: Math.max(0, height - side), width: side, height: side };
  return { x, y: (height - side) / 2, width: side, height: side };
}

function resample(image: ImageData, rect: SampleRect, destWidth: number, destHeight: number): ImageData | null {
  if (destWidth < 8 || destHeight < 8 || rect.width < 8 || rect.height < 8) return null;
  if (
    rect.x === 0 &&
    rect.y === 0 &&
    rect.width === image.width &&
    rect.height === image.height &&
    destWidth === image.width &&
    destHeight === image.height
  ) {
    return image;
  }
  const data = new Uint8ClampedArray(destWidth * destHeight * 4);
  for (let y = 0; y < destHeight; y += 1) {
    const gy = rect.y + ((y + 0.5) * rect.height) / destHeight - 0.5;
    const y1 = Math.floor(gy);
    const fy = gy - y1;
    for (let x = 0; x < destWidth; x += 1) {
      const gx = rect.x + ((x + 0.5) * rect.width) / destWidth - 0.5;
      const x1 = Math.floor(gx);
      const fx = gx - x1;
      const to = (y * destWidth + x) * 4;
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
  return asImage(data, destWidth, destHeight);
}

function stillSample(image: ImageData, step: DecodeStep): ImageData | null {
  if (step.region === 'center') return sampleSquare(image, step.edge, 1);
  if (step.region === 'tight') return sampleSquare(image, step.edge, 0.55);
  const rect = regionRect(image.width, image.height, step.region);
  if (step.region === 'full') {
    const long = Math.max(rect.width, rect.height);
    const scale = step.edge / long;
    const width = Math.max(8, Math.round(rect.width * scale));
    const height = Math.max(8, Math.round(rect.height * scale));
    return resample(image, rect, width, height);
  }
  return resample(image, rect, step.edge, step.edge);
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

async function decodeSamples(
  take: (step: DecodeStep) => ImageData | null,
  steps: readonly DecodeStep[],
  attempt: DecodeAttempt,
): Promise<string | null> {
  const cache = new Map<string, ImageData | null>();
  const decodeQR = await loadDecoder();
  if (attempt.cancelled) return null;
  const started = Date.now();
  for (const step of steps) {
    const remaining = budgetLeft(started);
    if (attempt.cancelled || remaining <= 8) return null;
    const key = `${step.region}:${step.edge}`;
    let cropped = cache.get(key);
    if (cropped === undefined) {
      cropped = take(step);
      cache.set(key, cropped);
    }
    if (!cropped) continue;
    const text = readDecoded(decodeQR, prepare(cropped, step.prepare), step.effort, remaining);
    if (text) return text;
  }
  return null;
}

function videoSteps(): readonly DecodeStep[] {
  const extra = VIDEO_EXTRA[videoTurn % VIDEO_EXTRA.length] ?? CENTER_RAW;
  videoTurn += 1;
  return [CENTER_RAW, extra];
}

function frameCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!scratch) scratch = document.createElement('canvas');
  return scratch;
}

function grabRegion(video: HTMLVideoElement, step: DecodeStep): ImageData | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width < 8 || height < 8) return null;
  const rect = step.region === 'tight'
    ? (() => {
        const side = Math.min(width, height);
        const span = Math.max(8, Math.round(side * 0.55));
        return { x: (width - span) / 2, y: (height - span) / 2, width: span, height: span };
      })()
    : regionRect(width, height, step.region);
  const dest = step.region === 'full'
    ? {
        width: Math.max(8, Math.round((rect.width * step.edge) / Math.max(rect.width, rect.height))),
        height: Math.max(8, Math.round((rect.height * step.edge) / Math.max(rect.width, rect.height))),
      }
    : { width: step.edge, height: step.edge };
  const canvas = frameCanvas();
  const context = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !context) return null;
  canvas.width = dest.width;
  canvas.height = dest.height;
  context.imageSmoothingEnabled = true;
  context.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, dest.width, dest.height);
  return context.getImageData(0, 0, dest.width, dest.height);
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
  return decodeSamples((step) => stillSample(image, step), STILL_STEPS, attempt);
}

async function readVideo(video: HTMLVideoElement, attempt: DecodeAttempt): Promise<string | null> {
  const native = nativeDetector();
  if (native && video.readyState >= 2 && !attempt.cancelled) {
    const text = await nativeValue(() => native.detect(video), attempt);
    if (text) return text;
  }
  if (attempt.cancelled || video.videoWidth < 8 || video.videoHeight < 8) return null;
  return decodeSamples((step) => grabRegion(video, step), videoSteps(), attempt);
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
