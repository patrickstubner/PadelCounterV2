/** Capture attempts, widest first. `ideal` is not `exact`: iOS rejects exact sizes. */
export const SCAN_VIDEO_CONSTRAINTS: readonly MediaTrackConstraints[] = [
  {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  { facingMode: { ideal: 'environment' } },
];

interface FocusCapabilities {
  focusMode?: readonly string[];
}

interface FocusTrack {
  getCapabilities?: () => FocusCapabilities;
  applyConstraints: (constraints: MediaTrackConstraints) => Promise<void>;
}

/**
 * Open the rear camera. The first constraint set asks for a 1080p frame.
 * A phone that refuses that size is asked for 720p, then for any rear camera.
 * Audio is never requested.
 */
export async function openScanCamera(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
): Promise<MediaStream> {
  let last: unknown;
  for (const video of SCAN_VIDEO_CONSTRAINTS) {
    try {
      return await getUserMedia({ audio: false, video });
    } catch (error) {
      last = error;
    }
  }
  if (last instanceof Error) throw last;
  throw new Error('The camera did not start.');
}

/**
 * Ask for continuous autofocus when the track lists it.
 * iOS Safari does not expose `focusMode`. A refusal leaves the camera running.
 */
export async function preferContinuousFocus(track: MediaStreamTrack): Promise<void> {
  const reader = track as unknown as FocusTrack;
  if (typeof reader.getCapabilities !== 'function') return;
  let modes: readonly string[] | undefined;
  try {
    modes = reader.getCapabilities().focusMode;
  } catch {
    return;
  }
  if (!modes?.includes('continuous')) return;
  try {
    await reader.applyConstraints({
      advanced: [{ focusMode: 'continuous' } as unknown as MediaTrackConstraintSet],
    });
  } catch {
    // The browser advertised the mode and then refused it. Scanning continues.
  }
}

/**
 * Run `run` on the next camera frame.
 * `requestVideoFrameCallback` is used when the video element has it (iOS Safari 15.4+, Chrome).
 * Otherwise the loop uses `requestAnimationFrame`.
 */
export function scheduleScanFrame(video: HTMLVideoElement, run: () => void): () => void {
  if (typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function') {
    const id = video.requestVideoFrameCallback(() => {
      run();
    });
    return () => {
      video.cancelVideoFrameCallback(id);
    };
  }
  const id = window.requestAnimationFrame(() => {
    run();
  });
  return () => {
    window.cancelAnimationFrame(id);
  };
}
