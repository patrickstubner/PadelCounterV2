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

/** Centred square edges tried by the software decoder. Full HD frames are not decoded whole. */
const SCAN_EDGES = [640, 480, 720] as const;

const SCAN_EFFORTS = [1, 3] as const;

let cachedDetector: QrDetector | null | undefined;

/** One software decode at a time. The `qr` scanner rejects overlapping work. */
let decodeBusy = false;

function nativeDetector(): QrDetector | null {
  if (cachedDetector !== undefined) return cachedDetector;
  const host = globalThis as BarcodeDetectorHost;
  cachedDetector = typeof host.BarcodeDetector === 'function'
    ? new host.BarcodeDetector({ formats: ['qr_code'] })
    : null;
  return cachedDetector;
}

function scanEdges(width: number, height: number): number[] {
  const side = Math.min(width, height);
  if (side < 8) return [];
  if (side <= SCAN_EDGES[2]) return [side];
  return SCAN_EDGES.filter((edge) => edge < side);
}

function asImage(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

/** Nearest-neighbour sample of the centred square. Integer-ish scales keep QR modules intact. */
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

function readDecoded(decodeQR: QrDecode, image: ImageData, effort: number): string | null {
  try {
    const text = decodeQR(
      { data: image.data, width: image.width, height: image.height },
      { effort, timeLimit: 80, nativeLimit: 720 },
    );
    return typeof text === 'string' && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

async function decodeSquares(image: ImageData): Promise<string | null> {
  const edges = scanEdges(image.width, image.height);
  if (edges.length === 0) return null;
  const { default: decodeQR } = await import('qr/decode.js');
  for (const effort of SCAN_EFFORTS) {
    for (const edge of edges) {
      const text = readDecoded(decodeQR as QrDecode, centerSquare(image, edge), effort);
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

async function decodeVideoSquares(video: HTMLVideoElement): Promise<string | null> {
  if (video.videoWidth < 1 || video.videoHeight < 1) return null;
  const edges = scanEdges(video.videoWidth, video.videoHeight);
  if (edges.length === 0) return null;
  const canvas = frameCanvas();
  const context = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !context) return null;
  const side = Math.min(video.videoWidth, video.videoHeight);
  const sx = (video.videoWidth - side) / 2;
  const sy = (video.videoHeight - side) / 2;
  const { default: decodeQR } = await import('qr/decode.js');
  for (const effort of SCAN_EFFORTS) {
    for (const edge of edges) {
      canvas.width = edge;
      canvas.height = edge;
      context.imageSmoothingEnabled = false;
      context.drawImage(video, sx, sy, side, side, 0, 0, edge, edge);
      const text = readDecoded(decodeQR as QrDecode, context.getImageData(0, 0, edge, edge), effort);
      if (text) return text;
    }
  }
  return null;
}

async function nativeText(detect: () => Promise<readonly QrHit[]>): Promise<string | null> {
  try {
    const codes = await detect();
    const value = codes[0]?.rawValue;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Native BarcodeDetector when the browser has it. Otherwise the pinned `qr` decoder. */
export async function readQrImage(image: ImageData): Promise<string | null> {
  if (decodeBusy) return null;
  if (image.width < 1 || image.height < 1) return null;
  decodeBusy = true;
  try {
    const native = nativeDetector();
    if (native) {
      const bitmap = await createImageBitmap(image);
      try {
        const text = await nativeText(() => native.detect(bitmap));
        if (text) return text;
      } finally {
        if (typeof bitmap.close === 'function') bitmap.close();
      }
    }
    return await decodeSquares(image);
  } finally {
    decodeBusy = false;
  }
}

export async function readQrVideo(video: HTMLVideoElement): Promise<string | null> {
  if (decodeBusy) return null;
  decodeBusy = true;
  try {
    const native = nativeDetector();
    if (native && video.readyState >= 2) {
      const text = await nativeText(() => native.detect(video));
      if (text) return text;
    }
    return await decodeVideoSquares(video);
  } finally {
    decodeBusy = false;
  }
}
