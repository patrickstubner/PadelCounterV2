import { withBase } from '../url';

/** Victory sound. Missing means on. Stored values are `on` and `off`. */
export const FANFARE_KEY = 'pcv2:fanfare';

/** Same-origin clip. It is not loaded from a third-party host. */
export const FANFARE_FILE = '06_crowd-in-hardrock.mp3';

export function fanfareEnabled(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(FANFARE_KEY) !== 'off';
}

export function setFanfareEnabled(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  storage.setItem(FANFARE_KEY, enabled ? 'on' : 'off');
}

/** Same moment as the celebration. One win, one fanfare. An early end does not celebrate. */
export function shouldPlayFanfare(
  showVictory: boolean,
  enabled: boolean,
  playedKey: string | null,
  victoryKey: string | null,
): boolean {
  return showVictory && enabled && victoryKey !== null && playedKey !== victoryKey;
}

export function fanfareSrc(): string {
  return withBase(FANFARE_FILE);
}

/** The clip is mastered loud. Half volume is near the old oscillator level. */
export const FANFARE_VOLUME = 0.5;

let clip: HTMLAudioElement | null = null;

/**
 * Play the local crowd clip. The path is this app's file, not a URL from the page.
 * If the browser refuses playback, this stays silent.
 */
export function stopFanfare(): void {
  const audio = clip;
  clip = null;
  if (!audio) return;
  try {
    audio.pause();
  } catch {
    // The element can already be gone.
  }
}

export function playFanfare(): void {
  const src = fanfareSrc();
  if (!src.endsWith(`/${FANFARE_FILE}`)) return;
  if (src.includes('://')) return;
  stopFanfare();
  try {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = FANFARE_VOLUME;
    clip = audio;
    const started = audio.play();
    if (started && typeof started.then === 'function') {
      void started.then(
        () => undefined,
        () => undefined,
      );
    }
  } catch {
    // Autoplay policies and a missing Audio stay quiet.
  }
}
