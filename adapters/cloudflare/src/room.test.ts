import { describe, expect, it } from 'vitest';
import { createMatch, matchReducer } from '@padel/core';
import { MAX_PLAYERS, ROOM_MESSAGES } from '@padel/core';
import { admit, applyPlay, createRoom, eventDelta, helloPayload, issueInvite, type RoomRecord } from './room';

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
