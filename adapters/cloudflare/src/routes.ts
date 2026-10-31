const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TICKET = '[A-Za-z0-9_-]{22}';

export type RouteKind = 'health' | 'create' | 'invite' | 'ticket' | 'socket' | 'carry' | 'leave' | 'auth' | 'none';

export function classifyPath(method: string, pathname: string): RouteKind {
  if (method === 'GET' && pathname === '/health') return 'health';
  if (method === 'POST' && pathname === '/matches') return 'create';
  if (method === 'POST' && new RegExp(`^/matches/${UUID}/invites$`, 'i').test(pathname)) return 'invite';
  if (method === 'POST' && new RegExp(`^/matches/${UUID}/carry$`, 'i').test(pathname)) return 'carry';
  if (method === 'POST' && new RegExp(`^/matches/${UUID}/leave$`, 'i').test(pathname)) return 'leave';
  if (method === 'POST' && pathname === '/join') return 'ticket';
  if (method === 'GET' && new RegExp(`^/ws/${TICKET}$`).test(pathname)) return 'socket';
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return 'auth';
  return 'none';
}

/**
 * Create, invite, the join ticket, and the websocket upgrade share the per-address cap.
 * Carry does not: phones on one court network must still be able to move together.
 * The durable object keeps its own per-phone carry cap. Health and auth are not included.
 */
export function limitsMatchRoute(kind: RouteKind): boolean {
  return kind === 'create' || kind === 'invite' || kind === 'ticket' || kind === 'socket' || kind === 'leave';
}

export function ticketFrom(pathname: string): string | null {
  const match = new RegExp(`^/ws/(${TICKET})$`).exec(pathname);
  return match?.[1] ?? null;
}

export function matchIdFrom(pathname: string): string | null {
  const match = new RegExp(`^/matches/(${UUID})/`, 'i').exec(pathname);
  return match?.[1]?.toLowerCase() ?? null;
}
