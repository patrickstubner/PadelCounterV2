import { RECONNECT_WINDOW_MS, planNewMatch } from '@padel/core';
import { describe, expect, it } from 'vitest';
import { replay, appendEvent, createLog } from './log';
import { carryLabels, carryOffer, commitNewMatch, customTeamNames, hasCarry, newMatchCopy } from './newMatch';

const NOW = 1_700_000_000_000;

describe('new match while one is open', () => {
  it('asks the host to finish and keeps reconnect inside the hour', () => {
    const recent = planNewMatch({ host: true, open: true, lastEventAt: NOW, now: NOW + 1_000, coPlayers: 2 });
    expect(newMatchCopy(recent)).toEqual({
      title: 'Finish current match and start a new one?',
      body: 'The current match ends and is kept in History. You can reopen it.',
      confirmLabel: 'Finish & new',
      confirmTestId: 'finish-and-new',
    });
    expect(recent.askCarry).toBe(true);
    expect(recent.carrySelected).toBe(true);
    expect(recent.showReconnect).toBe(false);
    const alone = planNewMatch({ host: true, open: true, lastEventAt: NOW, now: NOW + 1_000, coPlayers: 0 });
    expect(alone.showReconnect).toBe(true);
    expect(alone.reconnectSelected).toBe(false);
    const finished = commitNewMatch(recent, NOW, 'host');
    expect(finished.endOnServer).toBe(true);
    expect(finished.events.map((event) => event.type)).toEqual(['match/end', 'match/new']);
  });

  it('hides reconnect when the last event is older than an hour', () => {
    const stale = planNewMatch({
      host: true,
      open: true,
      lastEventAt: NOW,
      now: NOW + RECONNECT_WINDOW_MS + 1,
      coPlayers: 2,
    });
    expect(stale.showReconnect).toBe(false);
    expect(stale.askCarry).toBe(true);
    expect(stale.carrySelected).toBe(false);
    expect(newMatchCopy(stale).confirmLabel).toBe('Finish & new');
  });

  it('lets a non-host leave without ending the host match or taking the other phones', () => {
    const plan = planNewMatch({ host: false, open: true, lastEventAt: NOW, now: NOW, coPlayers: 2 });
    expect(plan.askCarry).toBe(false);
    expect(newMatchCopy(plan).confirmTestId).toBe('confirm-leave');
    expect(newMatchCopy(plan).body).toContain('You leave the shared match');
    const left = commitNewMatch(plan, NOW, 'p2');
    expect(left.endOnServer).toBe(false);
    expect(left.events.map((event) => event.type)).toEqual(['match/new']);
  });

  it('resets a blank court without ending a match', () => {
    const plan = planNewMatch({ host: true, open: false, lastEventAt: NOW, now: NOW, coPlayers: 0 });
    expect(newMatchCopy(plan).confirmTestId).toBe('confirm-reset');
    expect(commitNewMatch(plan, NOW, 'host').endOnServer).toBe(false);
  });
});

const TEAMS_DEFAULT = { a: { name: 'Team A' }, b: { name: 'Team B' } } as const;
const TEAMS_NAMED = { a: { name: 'Anna & Ben' }, b: { name: 'Carla & Dan' } } as const;

describe('carry phones and team names into the new match', () => {
  const recentHost = planNewMatch({ host: true, open: true, lastEventAt: NOW, lastScoreAt: NOW, now: NOW + 10 * 60_000, coPlayers: 2 });
  const staleHost = planNewMatch({
    host: true,
    open: true,
    lastEventAt: NOW,
    lastScoreAt: NOW,
    now: NOW + RECONNECT_WINDOW_MS + 1,
    coPlayers: 2,
  });

  it('offers both boxes, ticked, inside the hour after the last score change', () => {
    const offer = carryOffer(recentHost, TEAMS_NAMED);
    expect(offer).toEqual({ phones: true, names: { a: 'Anna & Ben', b: 'Carla & Dan' }, selected: true });
    expect(hasCarry(offer)).toBe(true);
  });

  it('offers both boxes, unticked, more than an hour after the last score change', () => {
    const offer = carryOffer(staleHost, TEAMS_NAMED);
    expect(offer.phones).toBe(true);
    expect(offer.names).not.toBeNull();
    expect(offer.selected).toBe(false);
  });

  it('offers only the names box when no phone is attached', () => {
    const solo = planNewMatch({ host: true, open: true, lastEventAt: NOW, now: NOW, coPlayers: 0 });
    const offer = carryOffer(solo, TEAMS_NAMED);
    expect(offer.phones).toBe(false);
    expect(offer.names).toEqual({ a: 'Anna & Ben', b: 'Carla & Dan' });
  });

  it('offers only the phones box when the names are still Team A and Team B', () => {
    const offer = carryOffer(recentHost, TEAMS_DEFAULT);
    expect(offer.phones).toBe(true);
    expect(offer.names).toBeNull();
    expect(customTeamNames(TEAMS_DEFAULT)).toBeNull();
  });

  it('offers nothing with default names and no phones', () => {
    const solo = planNewMatch({ host: true, open: true, lastEventAt: NOW, now: NOW, coPlayers: 0 });
    expect(hasCarry(carryOffer(solo, TEAMS_DEFAULT))).toBe(false);
  });

  it('keeps a single typed name and leaves the other side on its default', () => {
    expect(customTeamNames({ a: { name: 'Team A' }, b: { name: 'Lions' } })).toEqual({ b: 'Lions' });
    expect(carryLabels({ b: 'Lions' }).names).toBe('Keep team names (Team A · Lions)');
  });

  it('puts kept names on the new match and nothing when the box is off', () => {
    let log = createLog(NOW, '00000000-0000-4000-8000-0000000000aa');
    log = appendEvent(log, { type: 'team/rename', team: 'a', name: 'Anna & Ben', at: NOW + 1 });
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: NOW + 2 });
    const plan = planNewMatch({ host: true, open: true, lastEventAt: NOW + 2, now: NOW + 3, coPlayers: 0 });

    const kept = commitNewMatch(plan, NOW + 10, 'host', { a: 'Anna & Ben' });
    expect(kept.events.map((event) => event.type)).toEqual(['match/end', 'match/new', 'team/rename']);
    let next = log;
    for (const event of kept.events) next = appendEvent(next, event);
    const state = replay(next);
    expect(state.teams.a.name).toBe('Anna & Ben');
    expect(state.teams.b.name).toBe('Team B');
    expect(state.sets[0]).toEqual({ a: 0, b: 0 });
    expect(state.createdAt).toBe(state.updatedAt);

    const dropped = commitNewMatch(plan, NOW + 10, 'host', null);
    expect(dropped.events.map((event) => event.type)).toEqual(['match/end', 'match/new']);
    let fresh = log;
    for (const event of dropped.events) fresh = appendEvent(fresh, event);
    expect(replay(fresh).teams.a.name).toBe('Team A');
  });

  it('drops the line about default names on a blank court that keeps its names', () => {
    const blank = planNewMatch({ host: true, open: false, lastEventAt: NOW, now: NOW, coPlayers: 0 });
    expect(newMatchCopy(blank, carryOffer(blank, TEAMS_NAMED)).body).toBe('The score is reset.');
    expect(newMatchCopy(blank, carryOffer(blank, TEAMS_DEFAULT)).body).toContain('Team names go back');
  });
});
