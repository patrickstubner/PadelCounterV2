const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonal = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
  if (upDistance <= diagonal) return up;
  return upLeft;
}

function unfilter(filter: number, raw: Uint8Array, previous: Uint8Array, row: Uint8Array, channels: number): void {
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index] ?? 0;
    const left = index >= channels ? (row[index - channels] ?? 0) : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= channels ? (previous[index - channels] ?? 0) : 0;
    if (filter === 0) row[index] = value;
    else if (filter === 1) row[index] = (value + left) & 255;
    else if (filter === 2) row[index] = (value + up) & 255;
    else if (filter === 3) row[index] = (value + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) row[index] = (value + paeth(left, up, upLeft)) & 255;
    else throw new Error('bad png filter');
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Read an 8-bit RGB or RGBA PNG. Used by the scanner fixture tests. */
export async function decodePngRgba(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) throw new Error('not a png');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const parts: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4] ?? 0, bytes[offset + 5] ?? 0, bytes[offset + 6] ?? 0, bytes[offset + 7] ?? 0);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error('truncated png');
    const chunk = bytes.subarray(start, end);
    if (type === 'IHDR') {
      width = readU32(chunk, 0);
      height = readU32(chunk, 4);
      bitDepth = chunk[8] ?? 0;
      colorType = chunk[9] ?? 0;
    } else if (type === 'IDAT') {
      parts.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || width < 1 || height < 1) throw new Error('unsupported png');
  const channels = colorType === 6 ? 4 : 3;
  const packed = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    packed.set(part, cursor);
    cursor += part.length;
  }
  const inflated = await inflate(packed);
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  const previous = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source] ?? 0;
    source += 1;
    unfilter(filter, inflated.subarray(source, source + stride), previous, row, channels);
    source += stride;
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = row[from] ?? 0;
      out[to + 1] = row[from + 1] ?? 0;
      out[to + 2] = row[from + 2] ?? 0;
      out[to + 3] = channels === 4 ? (row[from + 3] ?? 255) : 255;
    }
    previous.set(row);
  }
  return { width, height, data: out };
}
