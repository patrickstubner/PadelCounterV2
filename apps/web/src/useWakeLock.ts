import { useEffect } from 'react';
import { createStayAwakeVideo, STAY_AWAKE_FILE } from './stayAwakeVideo';
import { withBase } from './url';
import { createStayAwake, screenWakeLockRequest } from './wakeLock';

/** Keep the screen on while a match is running. `running` is false after End match. */
export function useWakeLock(running: boolean): void {
  useEffect(() => {
    const video = createStayAwakeVideo(withBase(STAY_AWAKE_FILE));
    const stay = createStayAwake({
      requestWakeLock: screenWakeLockRequest(),
      video,
      isVisible: () => document.visibilityState === 'visible',
    });
    stay.setRunning(running);
    const onVisibility = (): void => {
      stay.onVisibility();
    };
    const onGesture = (): void => {
      stay.onGesture();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // iOS may not treat pointerdown as activation for video.play(). pointerup and click do.
    for (const type of ['pointerdown', 'pointerup', 'click'] as const) {
      document.addEventListener(type, onGesture, true);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      for (const type of ['pointerdown', 'pointerup', 'click'] as const) {
        document.removeEventListener(type, onGesture, true);
      }
      stay.dispose();
      video.destroy();
    };
  }, [running]);
}
