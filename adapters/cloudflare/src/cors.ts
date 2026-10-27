const PAGES_ORIGIN = 'https://patrickstubner.github.io';

export function isAllowedOrigin(origin: string | null, environment: string): boolean {
  if (!origin) return false;
  if (origin === PAGES_ORIGIN) return true;
  if (environment === 'development' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  return false;
}

export function corsHeaders(origin: string | null, environment: string): Headers {
  const headers = new Headers();
  headers.set('vary', 'Origin');
  if (!isAllowedOrigin(origin, environment)) return headers;
  headers.set('access-control-allow-origin', origin ?? '');
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type, authorization');
  headers.set('access-control-max-age', '600');
  return headers;
}
