/** @vitest-environment happy-dom */
import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLog } from '../domain/log';
import type { LiveSend } from '../hooks/useMatch';
import { useLive } from './useLive';

const API = 'https://padel-counter.example.workers.dev';

let joinByCode: (code: string) => Promise<boolean> = async () => {
  throw new Error('join is not ready');
};

function Probe() {
  const liveRef = useRef<LiveSend | null>(null);
  const logRef = useRef(createLog(1_700_000_000_000));
  const room = useLive(
    liveRef,
    () => undefined,
    () => undefined,
    () => undefined,
    () => logRef.current,
  );
  const joinRef = useRef(room.joinByCode);
  joinRef.current = room.joinByCode;
  useEffect(() => {
    joinByCode = (code) => joinRef.current(code);
  }, []);
  return null;
}

describe('joinByCode', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    for (const view of mounted.splice(0)) {
      await act(async () => {
        view.root.unmount();
      });
      view.container.remove();
    }
    globalThis.fetch = originalFetch;
    delete (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__;
    joinByCode = async () => {
      throw new Error('join is not ready');
    };
  });

  it('does not fetch a code outside the alphabet and sends a canonical code', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    const bodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      expect(String(input).endsWith('/join')).toBe(true);
      return Response.json({ error: 'bad_token' }, { status: 401 });
    }) as typeof fetch;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(<Probe />);
    });
    let refused = true;
    await act(async () => {
      refused = await joinByCode('ungueltig');
    });
    expect(refused).toBe(false);
    expect(bodies).toEqual([]);
    let accepted = false;
    await act(async () => {
      accepted = await joinByCode('k7m4 2qab');
    });
    expect(accepted).toBe(false);
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ code: 'K7M4-2QAB' });
  });
});
