import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fanfareEnabled, playFanfare, setFanfareEnabled, shouldPlayFanfare } from './fanfare';

describe('victory fanfare', () => {
  it('is on unless this device stored off', () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
    };
    expect(fanfareEnabled(storage)).toBe(true);
    setFanfareEnabled(storage, false);
    expect(stored.get('pcv2:fanfare')).toBe('off');
    expect(fanfareEnabled(storage)).toBe(false);
    setFanfareEnabled(storage, true);
    expect(fanfareEnabled(storage)).toBe(true);
  });

  it('plays once for the same celebration key', () => {
    expect(shouldPlayFanfare(true, true, null, 'win-1')).toBe(true);
    expect(shouldPlayFanfare(true, true, 'win-1', 'win-1')).toBe(false);
    expect(shouldPlayFanfare(true, false, null, 'win-1')).toBe(false);
    expect(shouldPlayFanfare(false, true, null, 'win-1')).toBe(false);
  });

  it('stays silent when the browser refuses audio', () => {
    const previous = globalThis.AudioContext;
    globalThis.AudioContext = class {
      constructor() {
        throw new Error('denied');
      }
    } as unknown as typeof AudioContext;
    expect(() => playFanfare()).not.toThrow();
    globalThis.AudioContext = previous;
  });

  it('synthesizes the sound and does not name an audio file', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fanfare.ts'), 'utf8');
    expect(source).toContain('AudioContext');
    expect(source).not.toMatch(/\.mp3|\.wav|\.ogg|fetch\(/);
  });
});
