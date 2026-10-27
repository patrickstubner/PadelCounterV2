export const CLIENT_IP_HEADER = 'x-padel-client-ip';

const FIND_MATCH = 'SELECT id FROM matches WHERE id = ?';
const INSERT_MATCH = 'INSERT INTO matches (id, created_at, last_activity) VALUES (?, ?, ?)';

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(query: string): D1Statement;
}

export interface MatchIndex {
  find(id: string): Promise<boolean>;
  insert(id: string, now: number): Promise<void>;
}

export function d1MatchIndex(db: D1Like): MatchIndex {
  return {
    async find(id) {
      const row = await db.prepare(FIND_MATCH).bind(id).first();
      return row !== null;
    },
    async insert(id, now) {
      await db.prepare(INSERT_MATCH).bind(id, now, now).run();
    },
  };
}

export function clientAddress(request: Request): string {
  const address = request.headers.get('cf-connecting-ip');
  return address && address.length > 0 && address.length <= 80 ? address : 'missing';
}

/** The worker sets the address. A client-supplied copy of the header is replaced. */
export function clientIpHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.set(CLIENT_IP_HEADER, clientAddress(request));
  return headers;
}
