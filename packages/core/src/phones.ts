/** Coarse device class. The raw User-Agent is not kept. */
export const DEVICE_KINDS = ['iphone', 'android', 'desktop', 'other'] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(DEVICE_KINDS);

export function isDeviceKind(value: unknown): value is DeviceKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

/**
 * Classify a User-Agent and drop the string.
 * iPhone is checked before Mac OS X, because an iPhone agent contains both.
 * Android is checked before Linux for the same reason.
 */
export function deviceKindFromAgent(agent: unknown): DeviceKind {
  if (typeof agent !== 'string' || agent.length === 0 || agent.length > 512) return 'other';
  if (/iPhone|iPod/i.test(agent)) return 'iphone';
  if (/Android/i.test(agent)) return 'android';
  if (/Windows NT|Macintosh|Mac OS X|CrOS|X11|Linux/i.test(agent)) return 'desktop';
  return 'other';
}

export function deviceKindLabel(kind: DeviceKind): string {
  switch (kind) {
    case 'iphone':
      return 'iPhone';
    case 'android':
      return 'Android';
    case 'desktop':
      return 'Desktop';
    default:
      return 'Other';
  }
}

/** Seat ids already appear on score events. They are not device secrets. */
const SEAT = /^(?:host|p(?:[2-9]|[1-2]\d|3[0-2]))$/;

export function isPublicSeat(value: unknown): value is string {
  return typeof value === 'string' && SEAT.test(value);
}

/**
 * Who may remove a phone.
 * Any admitted seat may remove any other seat except `host`.
 * The starter (`host`) may remove every other seat.
 * No seat may remove itself, and nothing in this check can mark a seat immune.
 */
export type KickVerdict = 'ok' | 'self' | 'starter' | 'bad';

export function decideKick(actorSeat: string, targetSeat: string): KickVerdict {
  if (!isPublicSeat(actorSeat) || !isPublicSeat(targetSeat)) return 'bad';
  if (actorSeat === targetSeat) return 'self';
  if (targetSeat === 'host' && actorSeat !== 'host') return 'starter';
  return 'ok';
}

export interface PublicPhone {
  readonly seat: string;
  readonly since: number;
  readonly online: boolean;
  readonly seen: number;
  readonly kind: DeviceKind;
  readonly self: boolean;
}

export interface RosterSource {
  readonly deviceId: string;
  readonly seat: string;
  readonly since: number;
  readonly seen: number;
  readonly online: boolean;
  readonly kind: string;
}

const MAX_PHONES = 8;

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
    ? value
    : null;
}

/** Copy only the public fields. Anything else on the row is dropped. */
export function publicPhoneList(rows: readonly RosterSource[], selfDeviceId: string | null): PublicPhone[] {
  const phones: PublicPhone[] = [];
  for (const row of rows) {
    if (phones.length >= MAX_PHONES) break;
    if (typeof row.seat !== 'string' || !SEAT.test(row.seat)) continue;
    const since = timestamp(row.since);
    const seen = timestamp(row.seen);
    if (since === null || seen === null || !isDeviceKind(row.kind)) continue;
    phones.push({
      seat: row.seat,
      since,
      online: row.online === true,
      seen,
      kind: row.kind,
      self: selfDeviceId !== null && row.deviceId === selfDeviceId,
    });
  }
  return phones;
}

/** Accept a roster from the socket. Unknown fields are ignored. A bad row drops the message. */
export function parsePublicPhones(value: unknown): PublicPhone[] | null {
  if (!Array.isArray(value) || value.length > MAX_PHONES) return null;
  const phones: PublicPhone[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    if (typeof source.seat !== 'string' || !SEAT.test(source.seat)) return null;
    const since = timestamp(source.since);
    const seen = timestamp(source.seen);
    if (since === null || seen === null || !isDeviceKind(source.kind)) return null;
    if (typeof source.online !== 'boolean' || typeof source.self !== 'boolean') return null;
    phones.push({
      seat: source.seat,
      since,
      online: source.online,
      seen,
      kind: source.kind,
      self: source.self,
    });
  }
  return phones;
}
