/** A socket that never sends hello is closed after this long. */
export const HELLO_TIMEOUT_MS = 5_000;

/** Un-helloed sockets from one address. Other addresses keep their own budget. */
export const MAX_PENDING_PER_IP = 4;

export interface SocketView {
  readonly ip: string;
  readonly admitted: boolean;
  readonly openedAt: number;
}

export function allowPending(sockets: readonly SocketView[], ip: string): boolean {
  const pending = sockets.filter((socket) => !socket.admitted && socket.ip === ip).length;
  return pending < MAX_PENDING_PER_IP;
}

export function expiredHello(sockets: readonly SocketView[], now: number): readonly SocketView[] {
  return sockets.filter((socket) => !socket.admitted && now - socket.openedAt >= HELLO_TIMEOUT_MS);
}

/** Next alarm for sockets that are still inside the hello window. */
export function nextHelloAlarm(sockets: readonly SocketView[], now: number): number | null {
  let next: number | null = null;
  for (const socket of sockets) {
    if (socket.admitted) continue;
    const due = socket.openedAt + HELLO_TIMEOUT_MS;
    if (due <= now) continue;
    if (next === null || due < next) next = due;
  }
  return next;
}
