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
    document.addEventListener('pointerdown', onGesture, true);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onGesture, true);
      stay.dispose();
      video.destroy();
    };
  }, [running]);
}
