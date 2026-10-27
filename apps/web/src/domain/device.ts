export const DEVICE_KEY = 'pcv2:device';

const DEVICE_PATTERN = /^d[a-f0-9]{8}$/;

/** Stable id for this browser. Sent when sharing or joining a live match. */
export function deviceId(storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  try {
    const existing = storage.getItem(DEVICE_KEY);
    if (existing && DEVICE_PATTERN.test(existing)) return existing;
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const id = `d${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    storage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'd00000000';
  }
}
