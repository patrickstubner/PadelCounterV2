/** Victory sound. Missing means on. Stored values are `on` and `off`. */
export const FANFARE_KEY = 'pcv2:fanfare';

export function fanfareEnabled(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(FANFARE_KEY) !== 'off';
}

export function setFanfareEnabled(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  storage.setItem(FANFARE_KEY, enabled ? 'on' : 'off');
}

/** Same moment as the celebration. One win, one fanfare. */
export function shouldPlayFanfare(
  showVictory: boolean,
  enabled: boolean,
  playedKey: string | null,
  victoryKey: string | null,
): boolean {
  return showVictory && enabled && victoryKey !== null && playedKey !== victoryKey;
}

/**
 * A short major arpeggio from oscillators. No audio file is fetched.
 * If the browser refuses playback, this stays silent.
 */
export function playFanfare(): void {
  try {
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const audio = new Context();
    const now = audio.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let index = 0; index < notes.length; index += 1) {
      const tone = audio.createOscillator();
      const level = audio.createGain();
      const start = now + index * 0.12;
      tone.type = 'triangle';
      tone.frequency.value = notes[index] ?? 523.25;
      level.gain.setValueAtTime(0.0001, start);
      level.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
      level.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      tone.connect(level);
      level.connect(audio.destination);
      tone.start(start);
      tone.stop(start + 0.3);
    }
    window.setTimeout(() => {
      void audio.close().catch(() => undefined);
    }, 1200);
  } catch {
    // Autoplay policies and a missing AudioContext stay quiet.
  }
}
