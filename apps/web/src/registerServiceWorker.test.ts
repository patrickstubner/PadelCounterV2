import { describe, expect, it } from 'vitest';
import { UPDATE_READY_LABEL, watchControllerChange, type ServiceWorkerContainerLike } from './registerServiceWorker';

function fakeContainer(controller: object | null): ServiceWorkerContainerLike & { emit: () => void } {
  const listeners = new Set<() => void>();
  return {
    controller,
    addEventListener(_type: 'controllerchange', listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: 'controllerchange', listener: () => void) {
      listeners.delete(listener);
    },
    emit() {
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('service worker controller change', () => {
  it('ignores the first install and reports one later takeover', () => {
    const first = fakeContainer(null);
    let updates = 0;
    watchControllerChange(first, () => {
      updates += 1;
    });
    first.emit();
    first.emit();
    expect(updates).toBe(0);

    const next = fakeContainer({});
    const stop = watchControllerChange(next, () => {
      updates += 1;
    });
    next.emit();
    next.emit();
    expect(updates).toBe(1);
    stop();
    next.emit();
    expect(updates).toBe(1);
    expect(UPDATE_READY_LABEL).toBe('Update ready');
  });
});
