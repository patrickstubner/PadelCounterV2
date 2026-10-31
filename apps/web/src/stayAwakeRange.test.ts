import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSW } from 'workbox-build';
import { STAY_AWAKE_CACHE, stayAwakeRuntimeCaching } from './stayAwakeCache';

const CLIP_URL = 'https://patrickstubner.github.io/PadelCounterV2/stay-awake.mp4';

describe('stay-awake range requests', () => {
  let respond: (range: string) => Promise<Response>;
  let directory = '';

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'padel-sw-'));
    const app = join(directory, 'app');
    await mkdir(app);
    await writeFile(join(app, 'placeholder.txt'), 'ok');
    const swDest = join(directory, 'sw.js');
    await generateSW({
      swDest,
      globDirectory: app,
      globPatterns: ['**/*.txt'],
      globIgnores: ['**/stay-awake.mp4'],
      inlineWorkboxRuntime: true,
      mode: 'production',
      sourcemap: false,
      clientsClaim: true,
      skipWaiting: true,
      cacheId: 'padel-counter-v2-2.3.3',
      disableDevLogs: true,
      runtimeCaching: stayAwakeRuntimeCaching,
    });
    const code = await readFile(swDest, 'utf8');
    expect(code).not.toContain('stay-awake.mp4');
    expect(code).toContain('Content-Range');
    respond = serviceWorkerResponder(code, Uint8Array.from({ length: 10 }, (_, index) => index + 1));
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('answers a Range request with 206 and Content-Range', async () => {
    const probe = await respond('bytes=0-1');
    expect(probe.status).toBe(206);
    expect(probe.headers.get('Content-Range')).toBe('bytes 0-1/10');
    expect(probe.headers.get('Content-Length')).toBe('2');
    expect(new Uint8Array(await probe.arrayBuffer())).toEqual(Uint8Array.from([1, 2]));

    const rest = await respond('bytes=2-');
    expect(rest.status).toBe(206);
    expect(rest.headers.get('Content-Range')).toBe('bytes 2-9/10');
    expect(rest.headers.get('Content-Length')).toBe('8');
    expect(new Uint8Array(await rest.arrayBuffer())).toEqual(Uint8Array.from([3, 4, 5, 6, 7, 8, 9, 10]));
  });
});

function serviceWorkerResponder(code: string, bytes: Uint8Array): (range: string) => Promise<Response> {
  const listeners = new Map<string, Array<(event: { request: Request; respondWith: (value: Promise<Response>) => void; waitUntil: () => void }) => void>>();
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const full = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(body.byteLength),
    },
  });
  const cache = new Map<string, Response>([[CLIP_URL, full]]);
  const caches = {
    async match(request: Request, options?: { cacheName?: string }): Promise<Response | undefined> {
      if (options?.cacheName !== STAY_AWAKE_CACHE) return undefined;
      return cache.get(request.url)?.clone();
    },
    async open(name: string) {
      return {
        async put(request: Request, response: Response) {
          if (name === STAY_AWAKE_CACHE) cache.set(request.url, response);
        },
        async match(request: Request) {
          return cache.get(request.url)?.clone();
        },
        async keys() {
          return [];
        },
      };
    },
  };
  const location = new URL('https://patrickstubner.github.io/PadelCounterV2/sw.js');
  const self = {
    addEventListener(type: string, fn: (event: { request: Request; respondWith: (value: Promise<Response>) => void; waitUntil: () => void }) => void) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    skipWaiting() {
      return Promise.resolve();
    },
    clients: { claim: () => Promise.resolve() },
    caches,
    location,
  };
  const sandbox = {
    self,
    caches,
    location,
    registration: { scope: 'https://patrickstubner.github.io/PadelCounterV2/' },
    fetch: globalThis.fetch,
    Response,
    Request,
    Headers,
    URL,
    Blob,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    FetchEvent: class FetchEvent {},
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'sw.js' });
  const fetchListeners = listeners.get('fetch') ?? [];

  return async (range: string) => {
    const request = new Request(CLIP_URL, { headers: { Range: range } });
    let pending: Promise<Response> | undefined;
    const event = {
      request,
      respondWith(value: Promise<Response>) {
        pending = value;
      },
      waitUntil() {
        return undefined;
      },
    };
    for (const listener of fetchListeners) listener(event);
    if (!pending) throw new Error('service worker did not respond');
    return pending;
  };
}
