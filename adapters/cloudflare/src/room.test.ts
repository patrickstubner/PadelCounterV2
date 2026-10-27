import { describe, expect, it } from 'vitest';
import { createMatch, matchReducer, MAX_PLAYERS, MAX_PLAYER_ACTOR, ROOM_CLOSE_MS, ROOM_MESSAGES } from '@padel/core';
import { admit, applyLiveEvent, applyPlay, chooseActor, createRoom, eventDelta, helloPayload, invitesForCarry, issueInvite, serverLastChange, type InviteRow, type RoomRecord } from './room';

const NOW = 1_700_000_000_000;
const HOST = 'a'.repeat(64);
const INVITE = 'b'.repeat(64);

function started(): RoomRecord {
  const log = {
    schemaVersion: 2 as const,
    base: createMatch(NOW, '00000000-0000-4000-8000-0000000000aa'),
    events: [],
  };
  return createRoom(log, HOST, NOW).record;
}

function withInvite(record: RoomRecord): RoomRecord {
  const issued = issueInvite(record, HOST, 'player', INVITE, NOW);
  if (!issued.ok) throw new Error('invite failed');
  return issued.record;
}

describe('four player limit', () => {
  it('admits four player sockets and rejects the fifth with a clear message', () => {
    const record = withInvite(started());
    for (let connected = 0; connected < MAX_PLAYERS; connected += 1) {
      const result = helloPayload(record, connected === 0 ? HOST : INVITE, connected, NOW);
      expect(result.ok, `player ${connected + 1}`).toBe(true);
      if (result.ok) expect(result.payload.players).toBe(connected + 1);
    }
    const fifth = helloPayload(record, INVITE, MAX_PLAYERS, NOW);
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) {
      expect(fifth.code).toBe('match_full');
      expect(fifth.message).toBe('This match already has 4 players.');
      expect(fifth.payload.message).toBe(ROOM_MESSAGES.match_full);
    }
  });

  it('frees a place when a player leaves', () => {
    const record = withInvite(started());
    expect(admit(record, INVITE, MAX_PLAYERS, NOW).ok).toBe(false);
    expect(admit(record, INVITE, MAX_PLAYERS - 1, NOW).ok).toBe(true);
  });
});

describe('role checks', () => {
  it('does not issue a spectator code', () => {
    const result = issueInvite(started(), HOST, 'spectator', INVITE, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('spectator_not_available');
      expect(result.message).toBe('View-only links are not available yet.');
    }
  });

  it('rejects a spectator token even when the room is empty', () => {
    const record: RoomRecord = {
      ...started(),
      invites: [
        ...started().invites,
        { tokenHash: 'c'.repeat(64), role: 'spectator', host: false, expiresAt: NOW + 1000, revokedAt: null },
      ],
    };
    const result = helloPayload(record, 'c'.repeat(64), 0, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe(ROOM_MESSAGES.spectator_not_available);
  });

  it('lets a player change the score and refuses a spectator', () => {
    const record = started();
    const eventId = '00000000-0000-4000-8000-0000000000bb';
    const raw = { type: 'game/increment', team: 'a', at: NOW };
    const played = applyPlay(record, { role: 'player', host: false }, eventId, raw, NOW + 5);
    expect(played.ok).toBe(true);
    if (played.ok) {
      expect(played.event.event).toMatchObject({ type: 'game/increment', team: 'a' });
      const next = matchReducer(record.base, played.event.event);
      expect(next.sets[0]).toEqual({ a: 1, b: 0 });
    }
    const denied = applyPlay(record, { role: 'spectator', host: false }, eventId, raw, NOW + 5);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.message).toBe('You cannot change the score from this connection.');
  });

  it('refuses undo and does not let a joiner mint a code', () => {
    const record = withInvite(started());
    const undo = applyPlay(
      record,
      { role: 'player', host: true },
      '00000000-0000-4000-8000-0000000000cc',
      { type: 'undo', at: NOW },
      NOW,
    );
    expect(undo.ok).toBe(false);
    const minted = issueInvite(record, INVITE, 'player', 'd'.repeat(64), NOW);
    expect(minted.ok).toBe(false);
    if (!minted.ok) expect(minted.code).toBe('forbidden');
  });

  it('stores only the token hash that the caller already hashed', () => {
    const raw = 'not-the-hash-value';
    const record = withInvite(started());
    const saved = JSON.stringify(record);
    expect(saved).toContain(INVITE);
    expect(saved).toContain(HOST);
    expect(saved).not.toContain(raw);
  });

  it('applies scoring from two players in arrival order', () => {
    let record = started();
    const first = applyPlay(
      record,
      { role: 'player', host: true },
      '00000000-0000-4000-8000-0000000000d1',
      { type: 'game/increment', team: 'a', at: 1 },
      NOW + 1,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    record = first.record;
    const second = applyPlay(
      record,
      { role: 'player', host: false },
      '00000000-0000-4000-8000-0000000000d2',
      { type: 'game/increment', team: 'b', at: 1 },
      NOW + 2,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.record.events).toHaveLength(2);
    let state = second.record.base;
    for (const item of second.record.events) state = matchReducer(state, item.event);
    expect(state.sets[0]).toEqual({ a: 1, b: 1 });
  });

  it('stores a sanitized name of at most 20 characters and broadcasts a delta', () => {
    const played = applyPlay(
      started(),
      { role: 'player', host: true },
      '00000000-0000-4000-8000-0000000000d3',
      { type: 'team/rename', team: 'a', name: '  Lobos\u0007 extra characters beyond twenty', at: 1 },
      NOW,
    );
    expect(played.ok).toBe(true);
    if (!played.ok || played.event.event.type !== 'team/rename') return;
    expect(played.event.event.name).toBe('Lobos extra characte');
    expect([...played.event.event.name].length).toBeLessThanOrEqual(20);
    const delta = eventDelta({
      eventId: played.event.eventId,
      event: played.event.event,
      duplicate: false,
      players: 2,
    });
    expect(Object.keys(delta)).not.toContain('log');
    expect(JSON.stringify(delta)).not.toContain('"log"');
  });
});

describe('event gate', () => {
  function invite(patch: Partial<InviteRow> = {}): InviteRow {
    return {
      tokenHash: INVITE,
      role: 'player',
      host: false,
      expiresAt: NOW + 60_000,
      revokedAt: null,
      ...patch,
    };
  }

  const eventId = '00000000-0000-4000-8000-0000000000e1';
  const raw = { type: 'game/increment', team: 'a', at: 1 };

  it('rejects an expired or revoked token on every event', () => {
    const record = withInvite(started());
    const expired = applyLiveEvent(record, invite({ expiresAt: NOW }), 'p2', eventId, raw, NOW);
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.code).toBe('expired');
    const revoked = applyLiveEvent(record, invite({ revokedAt: NOW - 1 }), 'p2', eventId, raw, NOW);
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(revoked.code).toBe('revoked');
  });

  it('lets the creator reopen after anyone ends, and only the creator after the creator ends', () => {
    const record = withInvite(started());
    const ended = applyLiveEvent(record, invite({ host: true, tokenHash: HOST }), 'host', eventId, { type: 'match/end', at: 1 }, NOW);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.record.base.ended || ended.event.event.type === 'match/end').toBe(true);
    const joiner = applyLiveEvent(
      ended.record,
      invite(),
      'p2',
      '00000000-0000-4000-8000-0000000000e2',
      { type: 'match/resume', at: 1 },
      NOW,
    );
    expect(joiner.ok).toBe(false);
    if (!joiner.ok) expect(joiner.code).toBe('forbidden');
    const host = applyLiveEvent(
      ended.record,
      invite({ host: true, tokenHash: HOST }),
      'host',
      '00000000-0000-4000-8000-0000000000e3',
      { type: 'match/resume', at: 1 },
      NOW,
    );
    expect(host.ok).toBe(true);
  });

  it('refuses a score one day after the last change', () => {
    const record = withInvite(started());
    const closed = applyLiveEvent(
      record,
      invite({ expiresAt: NOW + ROOM_CLOSE_MS + 60_000 }),
      'p2',
      eventId,
      raw,
      NOW + ROOM_CLOSE_MS,
    );
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe('closed');
  });

  it('offers reconnect only to devices that joined', () => {
    const record = withInvite(started());
    const joinedToken = record.invites.find((row) => !row.host)?.tokenHash ?? '';
    const listed = invitesForCarry(record.invites, [
      { tokenHash: joinedToken, deviceId: 'd11111111' },
      { tokenHash: joinedToken, deviceId: 'd22222222' },
      { tokenHash: 'e'.repeat(64), deviceId: 'd33333333' },
    ]);
    expect(listed.filter((row) => !row.host).map((row) => row.deviceId)).toEqual(['d11111111', 'd22222222']);
  });

  it('refuses a reconnect invite from a different device', () => {
    const record: RoomRecord = {
      ...started(),
      invites: [...started().invites, invite({ deviceId: 'dabcdef01' })],
    };
    expect(admit(record, INVITE, 0, NOW, 'dabcdef01').ok).toBe(true);
    expect(admit(record, INVITE, 0, NOW, 'd00000000').ok).toBe(false);
  });
});

describe('server clock', () => {
  const eventId = '00000000-0000-4000-8000-0000000000e1';
  const raw = { type: 'game/increment', team: 'a', at: 1 };

  function invite(): InviteRow {
    return { tokenHash: INVITE, role: 'player', host: false, expiresAt: NOW + ROOM_CLOSE_MS, revokedAt: null };
  }

  it('replaces a future or old seed clock with server time and the host', () => {
    const future = NOW + 10 * ROOM_CLOSE_MS;
    const old = NOW - 3 * ROOM_CLOSE_MS;
    for (const at of [future, old]) {
      const created = createRoom(
        {
          schemaVersion: 2,
          base: createMatch(at, '00000000-0000-4000-8000-0000000000aa'),
          events: [{ type: 'game/increment', team: 'a', at, by: 'p4' }],
        },
        HOST,
        NOW,
      );
      expect(created.record.serverCreatedAt).toBe(NOW);
      expect(created.record.base.createdAt).toBe(NOW);
      expect(created.record.base.updatedAt).toBe(NOW);
      expect(created.record.events[0]?.event.at).toBe(NOW);
      expect(created.record.events[0]?.event.by).toBe('host');
      expect(serverLastChange(created.record)).toBe(NOW);
      const issued = issueInvite(created.record, HOST, 'player', INVITE, NOW);
      if (!issued.ok) throw new Error('invite');
      const scored = applyLiveEvent(issued.record, invite(), 'p2', eventId, raw, NOW + 1000);
      expect(scored.ok).toBe(true);
    }
  });

  it('ignores a poisoned seed time and closes when the server clock is ahead or a day old', () => {
    const record = started();
    const seeded: RoomRecord = {
      ...record,
      events: [
        ...record.events,
        { eventId: 'seed-9', event: { type: 'game/increment', team: 'b', at: NOW + 9 * ROOM_CLOSE_MS } },
      ],
    };
    expect(serverLastChange(seeded)).toBe(NOW);
    const open = applyLiveEvent(seeded, invite(), 'p2', eventId, raw, NOW + 1000);
    expect(open.ok).toBe(true);

    const ahead: RoomRecord = { ...record, serverCreatedAt: NOW + 60_000 };
    const future = applyLiveEvent(ahead, invite(), 'p2', eventId, raw, NOW);
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.code).toBe('closed');

    const stale: RoomRecord = { ...record, serverCreatedAt: NOW - ROOM_CLOSE_MS };
    const closed = applyLiveEvent(stale, invite(), 'p2', eventId, raw, NOW);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe('closed');
  });
});

describe('player ids', () => {
  const token = 'c'.repeat(64);

  it('never reuses p4 and rejects when every id is taken', () => {
    const joined = ['p2', 'p3', 'p4'].map((playerId, index) => ({
      tokenHash: token,
      playerId,
      deviceId: `d0000000${index + 2}`,
    }));
    expect(
      chooseActor({ host: false, tokenHash: 'd'.repeat(64), deviceId: 'd99999999', joined, connected: [] }),
    ).toBe('p5');
    expect(
      chooseActor({
        host: false,
        tokenHash: token,
        deviceId: 'd00000004',
        joined,
        connected: [],
      }),
    ).toBe('p4');
    const full = Array.from({ length: MAX_PLAYER_ACTOR - 1 }, (_, index) => ({
      tokenHash: token,
      playerId: `p${index + 2}`,
      deviceId: `d${(index + 1).toString(16).padStart(8, '0')}`,
    }));
    expect(
      chooseActor({ host: false, tokenHash: 'e'.repeat(64), deviceId: 'dffffffff', joined: full, connected: [] }),
    ).toBeNull();
    expect(
      chooseActor({
        host: false,
        tokenHash: 'e'.repeat(64),
        deviceId: 'd00000009',
        joined: [],
        connected: [{ actor: 'p2', deviceId: 'd00000008' }],
      }),
    ).toBe('p3');
    expect(
      chooseActor({
        host: false,
        tokenHash: 'e'.repeat(64),
        deviceId: 'd00000009',
        joined: [],
        connected: [{ actor: 'p2', deviceId: null }],
      }),
    ).toBe('p3');
  });
});
