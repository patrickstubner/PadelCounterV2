import { isDeviceId, isLegacyDeviceId } from '@padel/core';

export const DEVICE_KEY = 'pcv2:device';
export const LEGACY_DEVICE_KEY = 'pcv2:device-legacy';

function randomDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `d${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

let rememberedId: string | null = null;

/** One id for this page when the browser cannot store one. Later calls return the same id. */
export function rememberedDeviceId(): string {
  if (rememberedId && isDeviceId(rememberedId)) return rememberedId;
  rememberedId = randomDeviceId();
  return rememberedId;
}

/** Stable 128-bit id for this browser. A stored 32-bit id is kept aside so the seat can move with it. */
export function deviceId(storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  try {
    const existing = storage.getItem(DEVICE_KEY);
    if (isDeviceId(existing)) return existing;
    const id = randomDeviceId();
    if (isLegacyDeviceId(existing)) storage.setItem(LEGACY_DEVICE_KEY, existing);
    storage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return rememberedDeviceId();
  }
}

export function legacyDeviceId(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    const value = storage.getItem(LEGACY_DEVICE_KEY);
    return isLegacyDeviceId(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearLegacyDeviceId(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(LEGACY_DEVICE_KEY);
  } catch {
    // The upgrade can be sent again next time.
  }
}
