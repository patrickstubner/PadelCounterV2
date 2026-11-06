import { RECONNECT_WINDOW_MS, planNewMatch } from '@padel/core';
import { describe, expect, it } from 'vitest';
import { commitNewMatch, newMatchCopy } from './newMatch';

const NOW = 1_700_000_000_000;

describe('new match while one is open', () => {
  it('asks the host to finish and keeps reconnect inside the hour', () => {
    const recent = planNewMatch({ host: true, open: true, lastEventAt: NOW, now: NOW + 1_000, coPlayers: 2 });
    expect(newMatchCopy(recent)).toMatchObject({
      title: 'Take the connected phones into the new match?',
      confirmLabel: 'Take phones',
      confirmTestId: 'take-phones',
      alternateLabel: 'Just this phone',
    });
    expect(recent.askCarry).toBe(true);
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
    expect(newMatchCopy(stale).confirmLabel).toBe('Take phones');
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
