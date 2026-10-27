import type { TeamId } from './types';

export const MAX_TEAM_NAME_LENGTH = 20;

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

export function sanitizeTeamName(input: string, team: TeamId): string {
  const stripped = stripUnsafe(input.normalize('NFC').replace(/\u00A0/g, ' ')).trim();
  const shortened = limitCodePoints(stripped, MAX_TEAM_NAME_LENGTH).trim();
  // A lone surrogate at the end can sit behind a space that trim has not seen yet.
  const cleaned = stripUnpairedSurrogates(shortened).trim();
  return cleaned.length > 0 ? cleaned : DEFAULT_TEAM_NAMES[team];
}

/** Fail closed for values already stored: do not trim or slice tampered data. */
export function isValidStoredName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (codePointLength(value) === 0 || codePointLength(value) > MAX_TEAM_NAME_LENGTH) return false;
  if (value !== value.normalize('NFC') || value !== value.trim()) return false;
  UNSAFE_CHARS.lastIndex = 0;
  UNPAIRED_SURROGATE.lastIndex = 0;
  if (UNSAFE_CHARS.test(value) || UNPAIRED_SURROGATE.test(value)) return false;
  return true;
}
