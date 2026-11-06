import type { RuntimeCaching } from 'workbox-build';

/** Runtime cache for the silent clip. It is not precached: a precached body is 200 with no Content-Range, and Safari will not play that. */
export const STAY_AWAKE_CACHE = 'padel-stay-awake';

/**
 * Same-origin clip, including a Range request. `rangeRequests` turns a cached
 * full response into 206 with Content-Range, which the home-screen app needs.
 */
export const stayAwakeRuntimeCaching: RuntimeCaching[] = [
  {
    urlPattern: /\/stay-awake\.mp4$/,
    handler: 'CacheFirst',
    options: {
      cacheName: STAY_AWAKE_CACHE,
      rangeRequests: true,
      cacheableResponse: { statuses: [200] },
    },
  },
];
