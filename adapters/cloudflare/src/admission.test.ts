import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allowPending, expiredHello, HELLO_TIMEOUT_MS, MAX_PENDING_PER_IP, nextHelloAlarm, type SocketView } from './admission';

function pending(ip: string, openedAt: number): SocketView {
  return { ip, admitted: false, openedAt };
}

describe('pending sockets', () => {
  it('limits silent sockets per address and still admits another address', () => {
    const sockets = Array.from({ length: MAX_PENDING_PER_IP }, () => pending('203.0.113.4', 1_000));
    expect(allowPending(sockets, '203.0.113.4')).toBe(false);
    expect(allowPending(sockets, '203.0.113.5')).toBe(true);
    expect(allowPending([...sockets, { ip: '203.0.113.4', admitted: true, openedAt: 1_000 }], '203.0.113.4')).toBe(false);
  });

  it('closes an un-helloed socket after 5 seconds and not before', () => {
    const sockets = [pending('203.0.113.4', 1_000), { ip: '203.0.113.5', admitted: true, openedAt: 1_000 }];
    expect(expiredHello(sockets, 1_000 + HELLO_TIMEOUT_MS - 1)).toHaveLength(0);
    expect(expiredHello(sockets, 1_000 + HELLO_TIMEOUT_MS)).toEqual([sockets[0]]);
    expect(HELLO_TIMEOUT_MS).toBe(5_000);
    expect(nextHelloAlarm(sockets, 1_000)).toBe(1_000 + HELLO_TIMEOUT_MS);
    expect(nextHelloAlarm(sockets, 1_000 + HELLO_TIMEOUT_MS)).toBeNull();
  });

  it('wires the durable object to the per-address timeout instead of a global pending cap', () => {
    const source = readFileSync(new URL('./match-room.ts', import.meta.url), 'utf8');
    expect(source).toContain('allowPending');
    expect(source).toContain('expiredHello');
    expect(source).toContain('takeLiveMessage');
    expect(source).toContain('eventDelta');
    expect(source).toContain('connectionCloses');
    expect(source).toContain('openRoomForCreate');
    expect(source).not.toContain('pending >= 4');
    expect(source).not.toContain('migrate(');
  });
});
