import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  allowPending,
  expiredHello,
  HELLO_TIMEOUT_MS,
  MAX_PENDING_PER_IP,
  MAX_PENDING_ROOM,
  nextHelloAlarm,
  type SocketView,
} from './admission';

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

  it('lets four players on one Wi-Fi each hold a handshake and a reconnect', () => {
    const wifi = '203.0.113.50';
    const seven = Array.from({ length: MAX_PENDING_PER_IP - 1 }, () => pending(wifi, 1_000));
    expect(allowPending(seven, wifi)).toBe(true);
    expect(allowPending([...seven, pending(wifi, 1_000)], wifi)).toBe(false);
    const playing = [
      ...Array.from({ length: 4 }, () => ({ ip: wifi, admitted: true, openedAt: 1_000 })),
      ...Array.from({ length: 4 }, () => pending(wifi, 2_000)),
    ];
    expect(allowPending(playing, wifi)).toBe(true);
    expect(MAX_PENDING_PER_IP).toBe(8);
  });

  it('refuses a seventeenth un-helloed socket in the room', () => {
    const fifteen = Array.from({ length: MAX_PENDING_ROOM - 1 }, (_, index) => pending(`203.0.113.${index + 1}`, 1_000));
    expect(allowPending(fifteen, '198.51.100.20')).toBe(true);
    expect(allowPending([...fifteen, pending('198.51.100.16', 1_000)], '198.51.100.20')).toBe(false);
    const twoNats = [
      ...Array.from({ length: 8 }, () => pending('203.0.113.10', 1_000)),
      ...Array.from({ length: 8 }, () => pending('203.0.113.11', 1_000)),
    ];
    expect(allowPending(twoNats, '203.0.113.12')).toBe(false);
    expect(MAX_PENDING_ROOM).toBe(16);
  });

  it('closes an un-helloed socket after 5 seconds and not before', () => {
    const sockets = [pending('203.0.113.4', 1_000), { ip: '203.0.113.5', admitted: true, openedAt: 1_000 }];
    expect(expiredHello(sockets, 1_000 + HELLO_TIMEOUT_MS - 1)).toHaveLength(0);
    expect(expiredHello(sockets, 1_000 + HELLO_TIMEOUT_MS)).toEqual([sockets[0]]);
    expect(HELLO_TIMEOUT_MS).toBe(5_000);
    expect(nextHelloAlarm(sockets, 1_000)).toBe(1_000 + HELLO_TIMEOUT_MS);
    expect(nextHelloAlarm(sockets, 1_000 + HELLO_TIMEOUT_MS)).toBeNull();
  });

  it('wires the durable object to both pending caps and the hello timeout', () => {
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
