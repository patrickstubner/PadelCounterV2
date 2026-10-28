import type { TeamId } from './types';

/** One cap for the court, the archive, the worker, and any stored name. D1 does not keep names. */
export const MAX_TEAM_NAME_LENGTH = 24;

/** Same limit as {@link MAX_TEAM_NAME_LENGTH}. Kept so older imports stay valid. */
export const MAX_LIVE_TEAM_NAME_LENGTH = MAX_TEAM_NAME_LENGTH;

/**
 * HTML `maxLength` counts UTF-16 code units. A code point is at most two units,
 * so the field can still hold {@link MAX_TEAM_NAME_LENGTH} code points.
 */
export const MAX_TEAM_NAME_UTF16_UNITS = MAX_TEAM_NAME_LENGTH * 2;

export const DEFAULT_TEAM_NAMES: Readonly<Record<TeamId, string>> = {
  a: 'Team A',
  b: 'Team B',
};

/** Controls, format characters, and line/paragraph separators. Shared by both checks. */
export const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Fillers that look blank. A name that contains one is refused. */
const INVISIBLE_NAME = /[\u115F\u1160\u3164\uFFA0\u2800]/g;

/** Consecutive combining marks on one base. A normal vowel sign is one or two. */
const MAX_CONSECUTIVE_MARKS = 4;

function isVariationSelector(value: string): boolean {
  const point = value.codePointAt(0) ?? 0;
  return (point >= 0xfe00 && point <= 0xfe0f) || (point >= 0xe0100 && point <= 0xe01ef);
}

function isCombiningMark(value: string): boolean {
  return /\p{M}/u.test(value) && !isVariationSelector(value);
}

/** More than four marks in a row, not counting variation selectors and not across the whole name. */
function hasTooManyConsecutiveMarks(value: string): boolean {
  let run = 0;
  for (const char of value) {
    if (isVariationSelector(char)) continue;
    if (isCombiningMark(char)) {
      run += 1;
      if (run > MAX_CONSECUTIVE_MARKS) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function withoutVariationSelectors(value: string): string {
  return Array.from(value).filter((char) => !isVariationSelector(char)).join('');
}

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

function limitCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

function stripUnsafe(value: string): string {
  UNSAFE_CHARS.lastIndex = 0;
  return value.replace(UNSAFE_CHARS, '');
}

function stripUnpairedSurrogates(value: string): string {
  UNPAIRED_SURROGATE.lastIndex = 0;
  return value.replace(UNPAIRED_SURROGATE, '');
}

/** Draft text for the name field: code-point cap, no lone surrogates. */
export function clampTeamNameDraft(value: string): string {
  return stripUnpairedSurrogates(limitCodePoints(value, MAX_TEAM_NAME_LENGTH));
}

/**
 * A live name is trimmed, at most 24 characters, and has no control characters.
 * Anything else is refused. The caller does not store the raw text.
 */
export function parseLiveTeamName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.normalize('NFC').replace(/\u00A0/g, ' ');
  UNSAFE_CHARS.lastIndex = 0;
  UNPAIRED_SURROGATE.lastIndex = 0;
  if (UNSAFE_CHARS.test(normalized) || UNPAIRED_SURROGATE.test(normalized)) return null;
  const trimmed = normalized.trim();
  const length = codePointLength(trimmed);
  if (length === 0 || length > MAX_TEAM_NAME_LENGTH) return null;
  INVISIBLE_NAME.lastIndex = 0;
  if (INVISIBLE_NAME.test(trimmed)) return null;
  if (codePointLength(withoutVariationSelectors(trimmed).trim()) === 0) return null;
  if (hasTooManyConsecutiveMarks(trimmed)) return null;
  return trimmed;
}

/** `A` or `B` on the wire. Lower case is accepted and stored as `a` or `b`. */
export function liveTeamSide(input: unknown): TeamId | null {
  if (input === 'A' || input === 'a') return 'a';
  if (input === 'B' || input === 'b') return 'b';
  return null;
}

/** Keep a valid live name, including one longer than the local field. Otherwise use the local rules. */
export function storedTeamName(input: string, team: TeamId): string {
  return parseLiveTeamName(input) ?? sanitizeTeamName(input, team);
}

export function sanitizeTeamName(input: string, team: TeamId): string {
  INVISIBLE_NAME.lastIndex = 0;
  const stripped = stripUnsafe(input.normalize('NFC').replace(/\u00A0/g, ' '))
    .replace(INVISIBLE_NAME, '');
  const shortened = limitCodePoints(stripped.trim(), MAX_TEAM_NAME_LENGTH).trim();
  // A lone surrogate at the end can sit behind a space that trim has not seen yet.
  // NFC again only composes a sequence that stripping a control left behind. A name that was already NFC is unchanged, marks included.
  const cleaned = stripUnpairedSurrogates(shortened).trim().normalize('NFC').trim();
  if (cleaned.length === 0 || codePointLength(withoutVariationSelectors(cleaned).trim()) === 0) {
    return DEFAULT_TEAM_NAMES[team];
  }
  return cleaned;
}

/** Drop marks past four in a row, then keep only a name parseLiveTeamName would accept. */
export function clampLiveTeamName(input: string, team: TeamId): string {
  INVISIBLE_NAME.lastIndex = 0;
  let run = 0;
  const limited = Array.from(stripUnsafe(input.normalize('NFC').replace(/\u00A0/g, ' ')).replace(INVISIBLE_NAME, '')).filter((char) => {
    if (isVariationSelector(char)) return true;
    if (!isCombiningMark(char)) {
      run = 0;
      return true;
    }
    run += 1;
    return run <= MAX_CONSECUTIVE_MARKS;
  }).join('');
  const shortened = limitCodePoints(limited.trim(), MAX_TEAM_NAME_LENGTH).trim();
  const cleaned = stripUnpairedSurrogates(shortened).trim().normalize('NFC').trim();
  if (cleaned.length === 0 || codePointLength(withoutVariationSelectors(cleaned).trim()) === 0) {
    return DEFAULT_TEAM_NAMES[team];
  }
  return parseLiveTeamName(cleaned) ?? DEFAULT_TEAM_NAMES[team];
}

/** A base name for a new live match. The per-base mark rule applies here, as it does for a rename. */
export function acceptsLiveBaseName(value: unknown): value is string {
  return typeof value === 'string' && parseLiveTeamName(value) === value;
}

/**
 * Fail closed for values already stored: do not trim, slice, or rewrite them.
 * The filler and mark rules apply to a new name only, so this stays as loose as the check on main.
 */
export function isValidStoredName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (codePointLength(value) === 0 || codePointLength(value) > MAX_TEAM_NAME_LENGTH) return false;
  if (value !== value.normalize('NFC') || value !== value.trim()) return false;
  UNSAFE_CHARS.lastIndex = 0;
  UNPAIRED_SURROGATE.lastIndex = 0;
  if (UNSAFE_CHARS.test(value) || UNPAIRED_SURROGATE.test(value)) return false;
  return true;
}
