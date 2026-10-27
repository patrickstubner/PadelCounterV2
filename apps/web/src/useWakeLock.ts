import { useEffect } from 'react';
import { acquireScreenWakeLock, type WakeLockHandle } from './wakeLock';

export function useWakeLock(): void {
  useEffect(() => {
    let stopped = false;
    let sentinel: WakeLockHandle | null = null;

    const arm = (): void => {
      void acquireScreenWakeLock().then((next) => {
        if (stopped || !next) {
          void next?.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      });
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') arm();
    };

    arm();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
