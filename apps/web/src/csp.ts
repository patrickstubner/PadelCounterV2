/**
 * Origins added to `connect-src`. An https API also needs `wss:` or the browser
 * blocks the live socket. `ws:` is added only for an http API while developing.
 */
export function connectSrcExtra(apiUrl: string, dev: boolean): string {
  if (!apiUrl) return '';
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return '';
  }
  if (url.username || url.password) return '';
  if (url.protocol === 'https:') return ` ${url.origin} wss://${url.host}`;
  if (url.protocol === 'http:' && dev) return ` ${url.origin} ws://${url.host}`;
  return '';
}
