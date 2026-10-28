/**
 * Short match codes such as K7M-42Q.
 * No 0/O, 1/I, or L, so a code read aloud is not ambiguous.
 * 31 symbols is not a power of two, so a byte is kept only when it is below 248.
 */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const JOIN_CODE_LENGTH = 6;

/** 31^6. About 2^29.7. */
export const JOIN_CODE_SPACE = 31 ** 6;

/** Bytes at or above this are discarded so `byte % 31` stays uniform. */
export const JOIN_CODE_BYTE_LIMIT = 256 - (256 % 31);

/**
 * Failed guesses of a short code, per address, in one minute.
 * Over the 2 hour invite this is 1,200 guesses. 1,200 / 31^6 is about 1.4e-6.
 */
export const CODE_FAILS_PER_IP = 10;

/**
 * Failed guesses of a short code from every address together, in one minute.
 * Over the 2 hour invite this is 7,200 guesses. 7,200 / 31^6 is about 8.1e-6.
 */
export const CODE_FAILS_GLOBAL = 60;

export function joinCodeCompact(code: string): string {
  return code.replace(/-/g, '');
}

/** Upper case, optional hyphen or spaces. Anything else is refused. */
export function normalizeJoinCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 16) return null;
  const compact = input.trim().toUpperCase().replace(/[\s-]+/g, '');
  if (compact.length !== JOIN_CODE_LENGTH) return null;
  for (const char of compact) {
    if (!JOIN_CODE_ALPHABET.includes(char)) return null;
  }
  return `${compact.slice(0, 3)}-${compact.slice(3)}`;
}

function randomByte(): number {
  const source = (globalThis as { crypto?: { getRandomValues: (bytes: Uint8Array) => Uint8Array } }).crypto;
  if (!source) throw new Error('crypto missing');
  const bytes = new Uint8Array(1);
  source.getRandomValues(bytes);
  return bytes[0] ?? 0;
}

/** Six unbiased symbols from the alphabet, shown as three, a hyphen, and three. */
export function randomJoinCode(nextByte: () => number = randomByte): string {
  let raw = '';
  while (raw.length < JOIN_CODE_LENGTH) {
    const value = nextByte();
    if (value < 0 || value >= JOIN_CODE_BYTE_LIMIT) continue;
    raw += JOIN_CODE_ALPHABET[value % JOIN_CODE_ALPHABET.length];
  }
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}
