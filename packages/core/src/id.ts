const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
}

function randomSource(): RandomSource {
  return (globalThis as { crypto?: RandomSource }).crypto ?? {};
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function createMatchId(): string {
  const source = randomSource();
  if (typeof source.randomUUID === 'function') {
    return source.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof source.getRandomValues !== 'function') {
    throw new Error('crypto unavailable');
  }
  source.getRandomValues(bytes);
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x40;
  bytes[8] = (b8 & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
