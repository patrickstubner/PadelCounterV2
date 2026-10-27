export interface WakeLockHandle {
  release(): Promise<void>;
}

/** Ask the screen to stay on. Missing API and permission errors resolve to null. */
export async function acquireScreenWakeLock(
  request?: () => Promise<WakeLockHandle>,
): Promise<WakeLockHandle | null> {
  const fn = request ?? defaultRequest();
  if (!fn) return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

function defaultRequest(): (() => Promise<WakeLockHandle>) | null {
  const nav = globalThis.navigator;
  if (!nav || !('wakeLock' in nav)) return null;
  return () => nav.wakeLock.request('screen');
}
