import { isDeviceId } from '@padel/core';

export const DEVICE_KEY = 'pcv2:device';

function randomDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `d${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Stable 128-bit id for this browser. Sent when sharing or joining a live match. */
export function deviceId(storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  try {
    const existing = storage.getItem(DEVICE_KEY);
    if (isDeviceId(existing)) return existing;
    const id = randomDeviceId();
    storage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return randomDeviceId();
  }
}
