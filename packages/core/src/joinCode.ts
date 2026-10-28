/**
 * Short match codes such as K7M4-2QAB.
 * No 0/O, 1/I, or L, so a code read aloud is not ambiguous.
 * 31 symbols is not a power of two, so a byte is kept only when it is below 248.
 */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const JOIN_CODE_LENGTH = 8;

/** 31^8 = 852,891,037,441. About 2^39.6. */
export const JOIN_CODE_SPACE = 31 ** 8;

/** Bytes at or above this are discarded so `byte % 31` stays uniform. */
export const JOIN_CODE_BYTE_LIMIT = 256 - (256 % 31);

/**
 * Every code attempt, hit or miss, for one IPv4 address or one IPv6 /64, in one minute.
 * Over the 2 hour invite that is 1,200 guesses. 1,200 / 31^8 is about 1.4e-9.
 * Checked before the code is read. Past the cap the answer is 429 for every code.
 * Ten stays under the isolate route cap of 20, and still fits a court joining together.
 */
export const CODE_ATTEMPTS_PER_PREFIX = 10;

/**
 * Worldwide attempts recorded in one minute. This is an alarm counter, not a lock.
 * Crossing it does not change the response, so one network cannot shut the code out for everyone.
 */
export const CODE_ALARM_GLOBAL = 10_000;

/** Device-bound tokens minted from a short code. The shared QR invite is not in this count. */
export const MAX_MINTED_TOKENS = 8;

export function joinCodeCompact(code: string): string {
  return code.replace(/-/g, '');
}

/** Upper case, optional hyphen or spaces. Anything else is refused. */
export function normalizeJoinCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const compact = input.trim().toUpperCase().replace(/[\s-]+/g, '');
  if (compact.length !== JOIN_CODE_LENGTH) return null;
  for (const char of compact) {
    if (!JOIN_CODE_ALPHABET.includes(char)) return null;
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function randomByte(): number {
  const source = (globalThis as { crypto?: { getRandomValues: (bytes: Uint8Array) => Uint8Array } }).crypto;
  if (!source) throw new Error('crypto missing');
  const bytes = new Uint8Array(1);
  source.getRandomValues(bytes);
  return bytes[0] ?? 0;
}

/** Eight unbiased symbols from the alphabet, shown as four, a hyphen, and four. */
export function randomJoinCode(nextByte: () => number = randomByte): string {
  let raw = '';
  while (raw.length < JOIN_CODE_LENGTH) {
    const value = nextByte();
    if (value < 0 || value >= JOIN_CODE_BYTE_LIMIT) continue;
    raw += JOIN_CODE_ALPHABET[value % JOIN_CODE_ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
