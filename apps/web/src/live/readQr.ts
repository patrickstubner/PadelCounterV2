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

/** Centred square edges tried by the software decoder. Full HD frames are not decoded whole. */
const SCAN_EDGES = [640, 480, 720] as const;

const SCAN_EFFORTS = [1, 3] as const;

/** One frame may spend about this long on crops and efforts. Later attempts are skipped. */
export const FRAME_BUDGET_MS = 80;

/**
 * A detect or decode that never settles must not leave the scanner locked.
 * This is longer than the frame budget so one sync decode can finish.
 */
export const DECODE_WAIT_MS = 1_000;

let cachedDetector: QrDetector | null = null;

/**
 * True while a frame is being read.
 * This is our lock. The sync `qr` decoder does not reject a second call.
 * The wait below clears the lock if that frame never settles.
 */
let decodeBusy = false;

function nativeDetector(): QrDetector | null {
  if (cachedDetector) return cachedDetector;
  const host = globalThis as BarcodeDetectorHost;
  if (typeof host.BarcodeDetector !== 'function') return null;
  cachedDetector = new host.BarcodeDetector({ formats: ['qr_code'] });
  return cachedDetector;
}

function scanEdges(width: number, height: number): number[] {
  const side = Math.min(width, height);
  if (side < 8) return [];
  if (side <= 720) return [side];
  return SCAN_EDGES.filter((edge) => edge < side);
}

function asImage(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

/** Nearest-neighbour sample of the centred square, smaller than the camera frame. */
function centerSquare(image: ImageData, edge: number): ImageData {
  const side = Math.min(image.width, image.height);
  const target = Math.min(edge, side);
  if (image.width === target && image.height === target) return image;
  const x0 = Math.floor((image.width - side) / 2);
  const y0 = Math.floor((image.height - side) / 2);
  const data = new Uint8ClampedArray(target * target * 4);
  for (let y = 0; y < target; y += 1) {
    const sy = y0 + Math.floor((y * side) / target);
    for (let x = 0; x < target; x += 1) {
      const sx = x0 + Math.floor((x * side) / target);
      const from = (sy * image.width + sx) * 4;
      const to = (y * target + x) * 4;
      data[to] = image.data[from] ?? 0;
      data[to + 1] = image.data[from + 1] ?? 0;
      data[to + 2] = image.data[from + 2] ?? 0;
      data[to + 3] = image.data[from + 3] ?? 255;
    }
  }
  return asImage(data, target, target);
}

function readDecoded(decodeQR: QrDecode, image: ImageData, effort: number, timeLimit: number): string | null {
  try {
    const text = decodeQR(
      { data: image.data, width: image.width, height: image.height },
      { effort, timeLimit, nativeLimit: 720 },
    );
    return typeof text === 'string' && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function budgetLeft(started: number): number {
  return FRAME_BUDGET_MS - (Date.now() - started);
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

async function decodeStill(image: ImageData, attempt: DecodeAttempt): Promise<string | null> {
  const edges = scanEdges(image.width, image.height);
  if (edges.length === 0 || attempt.cancelled) return null;
  const imported = await import('qr/decode.js');
  if (attempt.cancelled) return null;
  const decodeQR = imported.default as QrDecode;
  const started = Date.now();
  for (const effort of SCAN_EFFORTS) {
    for (const edge of edges) {
      const remaining = budgetLeft(started);
      if (attempt.cancelled || remaining <= 0) return null;
      const text = readDecoded(decodeQR, centerSquare(image, edge), effort, remaining);
      if (text) return text;
    }
  }
  return null;
}

let scratch: HTMLCanvasElement | null = null;

function frameCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!scratch) scratch = document.createElement('canvas');
  return scratch;
}

async function decodeVideo(video: HTMLVideoElement, attempt: DecodeAttempt): Promise<string | null> {
  if (attempt.cancelled || video.videoWidth < 1 || video.videoHeight < 1) return null;
  const edges = scanEdges(video.videoWidth, video.videoHeight);
  if (edges.length === 0) return null;
  const canvas = frameCanvas();
  const context = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !context) return null;
  const side = Math.min(video.videoWidth, video.videoHeight);
  const sx = (video.videoWidth - side) / 2;
  const sy = (video.videoHeight - side) / 2;
  const imported = await import('qr/decode.js');
  if (attempt.cancelled) return null;
  const decodeQR = imported.default as QrDecode;
  const started = Date.now();
  for (const effort of SCAN_EFFORTS) {
    for (const edge of edges) {
      const remaining = budgetLeft(started);
      if (attempt.cancelled || remaining <= 0) return null;
      canvas.width = edge;
      canvas.height = edge;
      context.imageSmoothingEnabled = false;
      context.drawImage(video, sx, sy, side, side, 0, 0, edge, edge);
      const text = readDecoded(decodeQR, context.getImageData(0, 0, edge, edge), effort, remaining);
      if (text) return text;
    }
  }
  return null;
}

async function nativeValue(detect: () => Promise<readonly QrHit[]>, attempt: DecodeAttempt): Promise<string | null> {
  if (attempt.cancelled) return null;
  try {
    const codes = await detect();
    if (attempt.cancelled) return null;
    const value = codes[0]?.rawValue;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readImage(image: ImageData, attempt: DecodeAttempt): Promise<string | null> {
  const native = nativeDetector();
  if (native && !attempt.cancelled) {
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
  return decodeStill(image, attempt);
}

async function readVideo(video: HTMLVideoElement, attempt: DecodeAttempt): Promise<string | null> {
  const native = nativeDetector();
  if (native && video.readyState >= 2 && !attempt.cancelled) {
    const text = await nativeValue(() => native.detect(video), attempt);
    if (text) return text;
  }
  if (attempt.cancelled) return null;
  return decodeVideo(video, attempt);
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

/** Native BarcodeDetector when it returns a code. Otherwise the pinned `qr` decoder. */
export async function readQrImage(image: ImageData): Promise<string | null> {
  if (image.width < 1 || image.height < 1) return null;
  return readLocked((attempt) => readImage(image, attempt));
}

export async function readQrVideo(video: HTMLVideoElement): Promise<string | null> {
  return readLocked((attempt) => readVideo(video, attempt));
}
