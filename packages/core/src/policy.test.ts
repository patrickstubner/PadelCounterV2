import { describe, expect, it } from 'vitest';
import { createMatch, matchReducer } from './reducer';
import {
  HISTORY_RETAIN_MS,
  HOST_ACTOR,
  MATCHES_PER_DAY,
  RECONNECT_WINDOW_MS,
  ROOM_CLOSE_MS,
  canReopen,
  carryTokenHashes,
  credentialAllowsEvent,
  historyExpired,
  isOpenMatch,
  offerReconnect,
  planNewMatch,
  roomAcceptsScore,
} from './policy';

const NOW = 1_700_000_000_000;
const JOINED = 'a'.repeat(64);
const OUTSIDER = 'b'.repeat(64);

describe('reconnect offer', () => {
  const invites = [
    { tokenHash: JOINED, host: false, deviceId: 'd11111111' },
    { tokenHash: OUTSIDER, host: false, deviceId: 'd22222222' },
    { tokenHash: 'c'.repeat(64), host: true, deviceId: 'd33333333' },
  ];

  it('carries nobody when the host does not confirm', () => {
    expect(carryTokenHashes({ confirm: false, hostInitiated: true, joinedHashes: [JOINED], invites })).toEqual([]);
  });

  it('carries every connected device that shared one code', () => {
    const shared = 'd'.repeat(64);
    const carried = carryTokenHashes({
      confirm: true,
      hostInitiated: true,
      joinedHashes: [shared],
      invites: [
        { tokenHash: shared, host: false, deviceId: 'd11111111' },
        { tokenHash: shared, host: false, deviceId: 'd22222222' },
        { tokenHash: shared, host: false, deviceId: null },
      ],
    });
    expect(carried.map((row) => row.deviceId)).toEqual(['d11111111', 'd22222222']);
  });

  it('does not carry an outsider or a request that did not come from the host', () => {
    const carried = carryTokenHashes({
      confirm: true,
      hostInitiated: true,
      joinedHashes: [JOINED],
      invites,
    });
    expect(carried.map((row) => row.tokenHash)).toEqual([JOINED]);
    expect(carryTokenHashes({ confirm: true, hostInitiated: false, joinedHashes: [JOINED], invites })).toEqual([]);
  });

  it('is not offered more than an hour after the last change', () => {
    expect(offerReconnect(1_000, 1_000 + RECONNECT_WINDOW_MS)).toBe(true);
    expect(offerReconnect(1_000, 1_000 + RECONNECT_WINDOW_MS + 1)).toBe(false);
  });

  it('rejects an expired or revoked token on an event', () => {
    expect(credentialAllowsEvent({ role: 'player', expiresAt: 2_000, revokedAt: null, now: 2_000 })).toBe('expired');
    expect(credentialAllowsEvent({ role: 'player', expiresAt: 5_000, revokedAt: 1, now: 2_000 })).toBe('revoked');
    expect(credentialAllowsEvent({ role: 'player', expiresAt: 5_000, revokedAt: null, now: 2_000 })).toBeNull();
  });
});

describe('new match while one is open', () => {
  it('asks the host to finish, with the reconnect toggle only inside the hour', () => {
    const recent = planNewMatch({ host: true, open: true, lastEventAt: NOW, now: NOW + 60_000, coPlayers: 2 });
    expect(recent).toEqual({ kind: 'finish', showReconnect: true, reconnectSelected: true });
    const alone = planNewMatch({ host: true, open: true, lastEventAt: NOW, now: NOW + 60_000, coPlayers: 0 });
    expect(alone.reconnectSelected).toBe(false);
    expect(alone.showReconnect).toBe(true);
    const stale = planNewMatch({
      host: true,
      open: true,
      lastEventAt: NOW,
      now: NOW + RECONNECT_WINDOW_MS + 1,
      coPlayers: 2,
    });
    expect(stale).toEqual({ kind: 'finish', showReconnect: false, reconnectSelected: false });
  });

  it('lets a non-host leave without ending the host match', () => {
    expect(planNewMatch({ host: false, open: true, lastEventAt: NOW, now: NOW, coPlayers: 3 })).toEqual({
      kind: 'leave',
      showReconnect: false,
      reconnectSelected: false,
    });
  });

  it('does not treat a blank court as an open match', () => {
    const blank = createMatch(NOW);
    expect(isOpenMatch(blank)).toBe(false);
    expect(planNewMatch({ host: true, open: false, lastEventAt: NOW, now: NOW, coPlayers: 0 }).kind).toBe('reset');
    const played = matchReducer(blank, { type: 'game/increment', team: 'a', at: NOW + 1 });
    expect(isOpenMatch(played)).toBe(true);
    expect(isOpenMatch({ ...played, ended: true })).toBe(false);
  });
});

describe('end and reopen', () => {
  const end = (by?: string) => ({ type: 'match/end' as const, by });

  it('ends at any score and limits who may reopen', () => {
    let state = createMatch(NOW);
    state = matchReducer(state, { type: 'match/end', at: NOW + 1, by: HOST_ACTOR });
    expect(state.sets[0]).toEqual({ a: 0, b: 0 });
    expect(state.ended).toBe(true);
    const mid = matchReducer(matchReducer(createMatch(NOW), { type: 'game/increment', team: 'b', at: NOW + 1 }), {
      type: 'match/end',
      at: NOW + 2,
    });
    expect(mid.ended).toBe(true);
    expect(mid.sets[0]).toEqual({ a: 0, b: 1 });

    const byHost = [end(HOST_ACTOR)];
    expect(canReopen({ events: byHost, actorId: HOST_ACTOR, actorIsHost: true })).toBe(true);
    expect(canReopen({ events: byHost, actorId: 'p2', actorIsHost: false })).toBe(false);

    const byPlayer = [end('p2')];
    expect(canReopen({ events: byPlayer, actorId: 'p2', actorIsHost: false })).toBe(true);
    expect(canReopen({ events: byPlayer, actorId: HOST_ACTOR, actorIsHost: true })).toBe(true);
    expect(canReopen({ events: byPlayer, actorId: 'p3', actorIsHost: false })).toBe(false);
    expect(canReopen({ events: [], actorId: HOST_ACTOR, actorIsHost: true })).toBe(false);
  });
});

describe('retention and daily creates', () => {
  it('closes scoring one day after the last event and keeps history for two years', () => {
    expect(roomAcceptsScore(NOW, NOW + ROOM_CLOSE_MS - 1)).toBe(true);
    expect(roomAcceptsScore(NOW, NOW + ROOM_CLOSE_MS)).toBe(false);
    expect(historyExpired(NOW, NOW + HISTORY_RETAIN_MS - 1)).toBe(false);
    expect(historyExpired(NOW, NOW + HISTORY_RETAIN_MS)).toBe(true);
    expect(MATCHES_PER_DAY).toBe(10);
  });
});
