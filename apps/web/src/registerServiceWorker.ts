import { withBase } from './url';

export const UPDATE_READY_LABEL = 'Update ready';

export interface ServiceWorkerContainerLike {
  readonly controller: unknown;
  addEventListener(type: 'controllerchange', listener: () => void): void;
  removeEventListener(type: 'controllerchange', listener: () => void): void;
}

/**
 * Reports the first time a new service worker replaces one that already controlled
 * this page. The first install (no controller yet) does not call `onUpdate` and
 * does not reload. A later takeover is reported once; the page reloads only if
 * the caller asks it to.
 */
export function watchControllerChange(container: ServiceWorkerContainerLike, onUpdate: () => void): () => void {
  const hadController = container.controller !== null && container.controller !== undefined;
  let reported = false;
  const onChange = (): void => {
    if (!hadController || reported) return;
    reported = true;
    onUpdate();
  };
  container.addEventListener('controllerchange', onChange);
  return () => {
    container.removeEventListener('controllerchange', onChange);
  };
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(withBase('sw.js'), { scope: withBase('') }).catch(() => undefined);
  });
}
