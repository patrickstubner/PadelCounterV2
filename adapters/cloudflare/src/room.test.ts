import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMatch, matchReducer, matchResult, MAX_PLAYERS, MAX_PLAYER_ACTOR, replayScore, ROOM_CLOSE_MS, ROOM_MESSAGES, scoreBoard, scoreClaimFor, type MatchEvent, type MatchState, type ScoreClaim, type TeamId } from '@padel/core';
import { admit, applyLiveEvent, applyPlay, chooseActor, createRoom, currentSharedInvite, eventDelta, helloPayload, invitesForCarry, issueInvite, serverLastChange, type InviteRow, type RoomRecord } from './room';

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

function claimFor(record: RoomRecord, event: MatchEvent) {
  return scoreClaimFor(replayScore(record.base, record.events.map((item) => item.event)), event);
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
      expect(fifth.message).toBe('This match is full.');
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
    const raw: MatchEvent = { type: 'game/increment', team: 'a', at: NOW };
    const played = applyPlay(record, { role: 'player', host: false }, eventId, raw, NOW + 5, undefined, claimFor(record, raw));
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

  it('refuses undo and lets a joined player replace the shared code', () => {
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
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(currentSharedInvite(minted.record, NOW)?.tokenHash).toBe('d'.repeat(64));
    expect(currentSharedInvite(minted.record, NOW + 1)?.tokenHash).toBe('d'.repeat(64));
    const previous = minted.record.invites.find((row) => row.tokenHash === INVITE);
    expect(previous?.revokedAt).toBe(NOW);
    expect(issueInvite(record, 'e'.repeat(64), 'player', 'f'.repeat(64), NOW).ok).toBe(false);
    expect(issueInvite(record, INVITE, 'player', 'f'.repeat(64), NOW + 9_000_000_000).ok).toBe(false);
    expect(currentSharedInvite(record, NOW + 9_000_000_000)).toBeNull();
  });

  it('stores no winner flag when End match leaves one set unfinished', () => {
    let record = started();
    const point: MatchEvent = { type: 'game/increment', team: 'a', at: NOW + 1 };
    for (let index = 0; index < 6; index += 1) {
      const played = applyLiveEvent(
        record,
        record.invites[0]!,
        'host',
        `00000000-0000-4000-8000-00000000010${index}`,
        { ...point, at: NOW + 1 + index },
        NOW + 1 + index,
        scoreClaimFor(replayScore(record.base, record.events.map((item) => item.event)), { ...point, at: NOW + 1 + index }),
      );
      expect(played.ok).toBe(true);
      if (played.ok) record = played.record;
    }
    const end: MatchEvent = { type: 'match/end', at: NOW + 20 };
    const ended = applyLiveEvent(
      record,
      record.invites[0]!,
      'host',
      '00000000-0000-4000-8000-0000000001aa',
      end,
      NOW + 20,
      scoreClaimFor(replayScore(record.base, record.events.map((item) => item.event)), end),
    );
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(JSON.stringify(ended.record.events)).not.toContain('winner');
    const state = replayScore(ended.record.base, ended.record.events.map((item) => item.event));
    expect(matchResult(state)).toEqual({ kind: 'leading', team: 'a' });
    const sql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
    expect(sql.toLowerCase()).not.toContain('winner');
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
    const firstEvent: MatchEvent = { type: 'game/increment', team: 'a', at: 1 };
    const first = applyPlay(
      record,
      { role: 'player', host: true },
      '00000000-0000-4000-8000-0000000000d1',
      firstEvent,
      NOW + 1,
      undefined,
      claimFor(record, firstEvent),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    record = first.record;
    const secondEvent: MatchEvent = { type: 'game/increment', team: 'b', at: 1 };
    const second = applyPlay(
      record,
      { role: 'player', host: false },
      '00000000-0000-4000-8000-0000000000d2',
      secondEvent,
      NOW + 2,
      undefined,
      claimFor(record, secondEvent),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.record.events).toHaveLength(2);
    let state = second.record.base;
    for (const item of second.record.events) state = matchReducer(state, item.event);
    expect(state.sets[0]).toEqual({ a: 1, b: 1 });
  });

  it('stores a sanitized name of at most 24 characters and broadcasts a delta', () => {
    const played = applyPlay(
      started(),
      { role: 'player', host: true },
      '00000000-0000-4000-8000-0000000000d3',
      { type: 'team/rename', team: 'a', name: '  Lobos\u0007 extra characters beyond twenty', at: 1 },
      NOW,
    );
    expect(played.ok).toBe(true);
    if (!played.ok || played.event.event.type !== 'team/rename') return;
    expect(played.event.event.name).toBe('Lobos extra characters b');
    expect([...played.event.event.name].length).toBeLessThanOrEqual(24);
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
    const endEvent: MatchEvent = { type: 'match/end', at: 1 };
    const ended = applyLiveEvent(record, invite({ host: true, tokenHash: HOST }), 'host', eventId, endEvent, NOW, claimFor(record, endEvent));
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.record.base.ended || ended.event.event.type === 'match/end').toBe(true);
    const resumeEvent: MatchEvent = { type: 'match/resume', at: 1 };
    const joiner = applyLiveEvent(
      ended.record,
      invite(),
      'p2',
      '00000000-0000-4000-8000-0000000000e2',
      resumeEvent,
      NOW,
      claimFor(ended.record, resumeEvent),
    );
    expect(joiner.ok).toBe(false);
    if (!joiner.ok) expect(joiner.code).toBe('forbidden');
    const host = applyLiveEvent(
      ended.record,
      invite({ host: true, tokenHash: HOST }),
      'host',
      '00000000-0000-4000-8000-0000000000e3',
      resumeEvent,
      NOW,
      claimFor(ended.record, resumeEvent),
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
  const raw: MatchEvent = { type: 'game/increment', team: 'a', at: 1 };

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
          events: [{ type: 'game/increment', team: 'a', at, capturedAt: at, by: 'p4' }],
        },
        HOST,
        NOW,
      );
      expect(created.record.serverCreatedAt).toBe(NOW);
      expect(created.record.base.createdAt).toBe(NOW);
      expect(created.record.base.updatedAt).toBe(NOW);
      expect(created.record.events[0]?.event.at).toBe(NOW);
      expect(created.record.events[0]?.event.capturedAt).toBe(NOW);
      expect(created.record.events[0]?.event.by).toBe('host');
      expect(serverLastChange(created.record)).toBe(NOW);
      const issued = issueInvite(created.record, HOST, 'player', INVITE, NOW);
      if (!issued.ok) throw new Error('invite');
      const scored = applyLiveEvent(issued.record, invite(), 'p2', eventId, raw, NOW + 1000, claimFor(issued.record, raw));
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
    const open = applyLiveEvent(seeded, invite(), 'p2', eventId, raw, NOW + 1000, claimFor(seeded, raw));
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

function eventId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function boardOf(record: RoomRecord) {
  return scoreBoard(replayScore(record.base, record.events.map((item) => item.event)));
}

function applyTeams(record: RoomRecord, teams: readonly TeamId[], idStart: number): RoomRecord {
  return teams.reduce((current, team, index) => {
    const state = replayScore(current.base, current.events.map((item) => item.event));
    const event: MatchEvent = { type: 'game/increment', team, at: state.updatedAt + 1 };
    const result = applyPlay(
      current,
      { role: 'player', host: true },
      eventId(idStart + index),
      event,
      NOW + idStart + index,
      'host',
      scoreClaimFor(state, event),
    );
    if (!result.ok) throw new Error(result.code);
    return result.record;
  }, record);
}

function offlineSteps(start: MatchState, teams: readonly TeamId[], type: 'game/increment' | 'game/decrement' = 'game/increment') {
  const steps: { event: MatchEvent; claim: ScoreClaim }[] = [];
  let state = start;
  for (const team of teams) {
    const event: MatchEvent = { type, team, at: state.updatedAt + 1 };
    const claim = scoreClaimFor(state, event);
    if (!claim) throw new Error('claim');
    steps.push({ event, claim });
    state = matchReducer(state, event);
  }
  return steps;
}

function pushClaim(record: RoomRecord, id: number, event: MatchEvent, claim: ScoreClaim | undefined, parent?: string | null) {
  return applyPlay(record, { role: 'player', host: true }, eventId(id), event, NOW + id, 'host', claim, parent);
}

describe('score reconcile', () => {
  const fourOne = ['a', 'a', 'a', 'a', 'b'] as const;

  it('does not apply phone A again when the server is already 4:3', () => {
    const atFourOne = applyTeams(started(), fourOne, 1);
    expect(boardOf(atFourOne).sets[0]).toEqual({ a: 4, b: 1 });
    const online = applyTeams(atFourOne, ['b', 'b'], 10);
    expect(boardOf(online).sets[0]).toEqual({ a: 4, b: 3 });
    const fork = atFourOne.events[atFourOne.events.length - 1]?.eventId ?? null;
    const queued = offlineSteps(replayScore(atFourOne.base, atFourOne.events.map((item) => item.event)), ['b', 'b']);
    const first = pushClaim(online, 30, queued[0]!.event, queued[0]!.claim, fork);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.reconciled).toBe('already');
    const second = pushClaim(online, 31, queued[1]!.event, queued[1]!.claim, '00000000-0000-4000-8000-000000000099');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('score_kept');
    expect(boardOf(online).sets[0]).toEqual({ a: 4, b: 3 });
  });

  it('applies only the offline point the server has not counted', () => {
    const atFourOne = applyTeams(started(), fourOne, 1);
    const online = applyTeams(atFourOne, ['b', 'b'], 10);
    const fork = atFourOne.events[atFourOne.events.length - 1]?.eventId ?? null;
    const queued = offlineSteps(replayScore(atFourOne.base, atFourOne.events.map((item) => item.event)), ['b', 'b', 'b']);
    const rejected = pushClaim(online, 40, queued[0]!.event, queued[0]!.claim, fork);
    expect(rejected.ok && rejected.reconciled).toBe('already');
    const extra = pushClaim(online, 42, queued[2]!.event, queued[2]!.claim);
    expect(extra.ok).toBe(true);
    if (!extra.ok) return;
    expect(extra.duplicate).toBe(false);
    expect(boardOf(extra.record).sets[0]).toEqual({ a: 4, b: 4 });
  });

  it('applies one phone’s minus, and does not apply that minus twice', () => {
    const atFourThree = applyTeams(started(), [...fourOne, 'b', 'b'], 1);
    expect(boardOf(atFourThree).sets[0]).toEqual({ a: 4, b: 3 });
    const start = replayScore(atFourThree.base, atFourThree.events.map((item) => item.event));
    const fork = atFourThree.events[atFourThree.events.length - 1]?.eventId ?? null;
    const minus = offlineSteps(start, ['a'], 'game/decrement');
    const applied = pushClaim(atFourThree, 50, minus[0]!.event, minus[0]!.claim, fork);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(boardOf(applied.record).sets[0]).toEqual({ a: 3, b: 3 });
    const again = pushClaim(applied.record, 51, minus[0]!.event, minus[0]!.claim, fork);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.reconciled).toBe('already');
    expect(boardOf(again.record).sets[0]).toEqual({ a: 3, b: 3 });
  });

  it('keeps the next game after a set both phones already closed', () => {
    const atFiveFour = applyTeams(started(), ['a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'], 1);
    const start = replayScore(atFiveFour.base, atFiveFour.events.map((item) => item.event));
    const fork = atFiveFour.events[atFiveFour.events.length - 1]?.eventId ?? null;
    const queued = offlineSteps(start, ['a', 'a']);
    const online = pushClaim(atFiveFour, 60, queued[0]!.event, queued[0]!.claim, fork);
    expect(online.ok).toBe(true);
    if (!online.ok) return;
    expect(boardOf(online.record).activeSet).toBe(1);
    const repeated = pushClaim(online.record, 61, queued[0]!.event, queued[0]!.claim, fork);
    expect(repeated.ok && repeated.reconciled).toBe('already');
    const nextGame = pushClaim(online.record, 62, queued[1]!.event, queued[1]!.claim);
    expect(nextGame.ok).toBe(true);
    if (!nextGame.ok) return;
    expect(boardOf(nextGame.record).sets[0]).toEqual({ a: 6, b: 4 });
    expect(boardOf(nextGame.record).sets[1]).toEqual({ a: 1, b: 0 });
    expect(boardOf(nextGame.record).activeSet).toBe(1);
  });

  it('adds the offline points when the phones scored for different teams', () => {
    const atFourOne = applyTeams(started(), fourOne, 1);
    const start = replayScore(atFourOne.base, atFourOne.events.map((item) => item.event));
    const online = applyTeams(atFourOne, ['a'], 70);
    expect(boardOf(online).sets[0]).toEqual({ a: 5, b: 1 });
    const fork = atFourOne.events[atFourOne.events.length - 1]?.eventId ?? null;
    const queued = offlineSteps(start, ['b', 'b']);
    const first = pushClaim(online, 80, queued[0]!.event, queued[0]!.claim, fork);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const after = replayScore(first.record.base, first.record.events.map((item) => item.event));
    const secondEvent = queued[1]!.event;
    const second = pushClaim(first.record, 81, secondEvent, scoreClaimFor(after, secondEvent) ?? undefined);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(boardOf(second.record).sets[0]).toEqual({ a: 5, b: 3 });
  });

  it('rejects a malformed or inconsistent claim and still dedupes an event id', () => {
    const record = started();
    const event: MatchEvent = { type: 'game/increment', team: 'a', at: NOW };
    const missing = pushClaim(record, 90, event, undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('not_applied');
    const wild = scoreClaimFor(createMatch(NOW), event);
    const forged = wild
      ? { ...wild, after: { ...wild.after, sets: [{ a: 4, b: 3 }, { a: 0, b: 0 }, { a: 0, b: 0 }] as ScoreClaim['after']['sets'] } }
      : undefined;
    const lied = pushClaim(record, 91, event, forged);
    expect(lied.ok).toBe(false);
    if (!lied.ok) expect(lied.code).toBe('not_applied');
    const good = pushClaim(record, 92, event, scoreClaimFor(createMatch(NOW), event) ?? undefined);
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const repeat = applyPlay(good.record, { role: 'player', host: true }, eventId(92), event, NOW, 'host', { extra: true });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.duplicate).toBe(true);
    expect(repeat.reconciled).toBeUndefined();
    expect(repeat.record.events).toHaveLength(good.record.events.length);
    expect(boardOf(good.record).sets[0]).toEqual({ a: 1, b: 0 });
  });
});
