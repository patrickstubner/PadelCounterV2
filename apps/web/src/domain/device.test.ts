import { describe, expect, it } from 'vitest';
import { isDeviceId } from '@padel/core';
import { DEVICE_KEY, LEGACY_DEVICE_KEY, deviceId, legacyDeviceId, rememberedDeviceId } from './device';

describe('deviceId', () => {
  it('stores 128 random bits and replaces a short legacy id', () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };
    const first = deviceId(storage);
    expect(isDeviceId(first)).toBe(true);
    expect(first).toHaveLength(33);
    expect(deviceId(storage)).toBe(first);
    saved.set(DEVICE_KEY, 'd00000000');
    const replaced = deviceId(storage);
    expect(isDeviceId(replaced)).toBe(true);
    expect(replaced).not.toBe('d00000000');
    expect(legacyDeviceId(storage)).toBe('d00000000');
    expect(saved.get(DEVICE_KEY)).toBe(replaced);
    expect(saved.get(LEGACY_DEVICE_KEY)).toBe('d00000000');
  });

  it('keeps one id when storage cannot remember it', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const first = deviceId(broken);
    const second = deviceId(broken);
    expect(first).toBe(second);
    expect(isDeviceId(first)).toBe(true);
    expect(rememberedDeviceId()).toBe(first);
  });
});
