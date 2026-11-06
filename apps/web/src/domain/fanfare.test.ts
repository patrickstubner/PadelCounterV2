import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FANFARE_FILE, FANFARE_VOLUME, fanfareEnabled, fanfareSrc, playFanfare, setFanfareEnabled, shouldPlayFanfare, stopFanfare } from './fanfare';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

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

  it('plays the local crowd clip and stays silent when playback is refused', () => {
    const src = fanfareSrc();
    expect(src.endsWith(`/${FANFARE_FILE}`)).toBe(true);
    expect(src.includes('://')).toBe(false);
    const played: string[] = [];
    const paused: string[] = [];
    const previous = globalThis.Audio;
    globalThis.Audio = class {
      src: string;
      preload = '';
      volume = 1;
      constructor(value?: string) {
        this.src = value ?? '';
      }
      play(): Promise<void> {
        played.push(`${this.volume}|${this.src}`);
        return Promise.reject(new Error('denied'));
      }
      pause(): void {
        paused.push(this.src);
      }
    } as unknown as typeof Audio;
    expect(FANFARE_VOLUME).toBe(0.5);
    expect(() => playFanfare()).not.toThrow();
    expect(played).toEqual([`0.5|${src}`]);
    stopFanfare();
    expect(paused).toEqual([src]);
    globalThis.Audio = class {
      constructor() {
        throw new Error('missing');
      }
    } as unknown as typeof Audio;
    expect(() => playFanfare()).not.toThrow();
    globalThis.Audio = previous;
  });

  it('pauses the first clip when a second one starts', () => {
    const src = fanfareSrc();
    const played: string[] = [];
    const paused: string[] = [];
    const previous = globalThis.Audio;
    globalThis.Audio = class {
      src: string;
      preload = '';
      volume = 1;
      constructor(value?: string) {
        this.src = value ?? '';
      }
      play(): Promise<void> {
        played.push(this.src);
        return Promise.resolve();
      }
      pause(): void {
        paused.push(this.src);
      }
    } as unknown as typeof Audio;
    playFanfare();
    playFanfare();
    expect(played).toEqual([src, src]);
    expect(paused).toEqual([src]);
    stopFanfare();
    globalThis.Audio = previous;
  });

  it('ships the checked crowd file and does not point at another host', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fanfare.ts'), 'utf8');
    expect(source).toContain(FANFARE_FILE);
    expect(source).toContain('withBase');
    expect(source).not.toContain('AudioContext');
    expect(source).not.toContain('http://');
    expect(source).not.toContain('https://');
    expect(source).not.toContain('freesound');
    const file = readFileSync(join(root, 'public', FANFARE_FILE));
    expect(createHash('sha256').update(file).digest('hex')).toBe(
      '09f686627dc2b8db4e1a32dc4e7a943b48a15e30c581a0beeb2ca4632c097a13',
    );
    expect(file.length).toBe(112892);
    const build = readFileSync(join(root, 'rsbuild.config.ts'), 'utf8');
    expect(build).toContain('mp3');
  });
});
