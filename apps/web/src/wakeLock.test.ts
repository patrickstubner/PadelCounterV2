import { describe, expect, it } from 'vitest';
import { acquireScreenWakeLock } from './wakeLock';

describe('acquireScreenWakeLock', () => {
  it('returns null when the API is absent', async () => {
    expect(await acquireScreenWakeLock(undefined)).toBeNull();
  });

  it('returns null when the request fails', async () => {
    const result = await acquireScreenWakeLock(() => Promise.reject(new Error('not allowed')));
    expect(result).toBeNull();
  });

  it('returns the sentinel when the request succeeds', async () => {
    let released = false;
    const handle = await acquireScreenWakeLock(async () => ({
      release: async () => {
        released = true;
      },
    }));
    expect(handle).not.toBeNull();
    await handle?.release();
    expect(released).toBe(true);
  });
});