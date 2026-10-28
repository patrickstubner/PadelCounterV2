interface QrHit {
  readonly rawValue?: string;
}

interface QrDetector {
  detect(source: CanvasImageSource): Promise<readonly QrHit[]>;
}

interface BarcodeDetectorHost {
  BarcodeDetector?: new (options: { formats: readonly string[] }) => QrDetector;
}

let cachedDetector: QrDetector | null | undefined;

function nativeDetector(): QrDetector | null {
  if (cachedDetector !== undefined) return cachedDetector;
  const host = globalThis as BarcodeDetectorHost;
  cachedDetector = typeof host.BarcodeDetector === 'function'
    ? new host.BarcodeDetector({ formats: ['qr_code'] })
    : null;
  return cachedDetector;
}

/** Native BarcodeDetector when the browser has it. Otherwise the pinned `qr` decoder. */
export async function readQrImage(image: ImageData): Promise<string | null> {
  const native = nativeDetector();
  if (native) {
    const bitmap = await createImageBitmap(image);
    try {
      const codes = await native.detect(bitmap);
      const value = codes[0]?.rawValue;
      return typeof value === 'string' && value.length > 0 ? value : null;
    } finally {
      if (typeof bitmap.close === 'function') bitmap.close();
    }
  }
  const { default: decodeQR } = await import('qr/decode.js');
  try {
    const text = decodeQR(
      { data: image.data, width: image.width, height: image.height },
      { effort: 1 },
    );
    return typeof text === 'string' && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function readQrVideo(video: HTMLVideoElement): Promise<string | null> {
  const native = nativeDetector();
  if (native) {
    if (video.readyState < 2) return null;
    const codes = await native.detect(video);
    const value = codes[0]?.rawValue;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  if (video.videoWidth < 1 || video.videoHeight < 1) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0);
  return readQrImage(context.getImageData(0, 0, canvas.width, canvas.height));
}
