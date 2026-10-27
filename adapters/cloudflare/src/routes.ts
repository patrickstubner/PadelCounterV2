const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export type RouteKind = 'health' | 'create' | 'invite' | 'socket' | 'auth' | 'none';

export function classifyPath(method: string, pathname: string): RouteKind {
  if (method === 'GET' && pathname === '/health') return 'health';
  if (method === 'POST' && pathname === '/matches') return 'create';
  if (method === 'POST' && new RegExp(`^/matches/${UUID}/invites$`, 'i').test(pathname)) return 'invite';
  if (method === 'GET' && new RegExp(`^/matches/${UUID}/ws$`, 'i').test(pathname)) return 'socket';
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return 'auth';
  return 'none';
}

/** Create, invite, and the websocket upgrade. Health and auth are not included. */
export function limitsMatchRoute(kind: RouteKind): boolean {
  return kind === 'create' || kind === 'invite' || kind === 'socket';
}

export function matchIdFrom(pathname: string): string | null {
  const match = new RegExp(`^/matches/(${UUID})/`, 'i').exec(pathname);
  return match?.[1]?.toLowerCase() ?? null;
}
