import { DEFAULT_TEAM_NAMES, type NewMatchPlan } from '@padel/core';
import { createMatchId } from './id';
import type { MatchEvent, MatchState, TeamId } from './types';

export interface NewMatchCommit {
  readonly events: readonly MatchEvent[];
  /** The host ends the shared match. Leaving or resetting a blank court does not. */
  readonly endOnServer: boolean;
}

/** Team names typed on this match. A side that still shows Team A or Team B is left out. */
export type CustomNames = Partial<Record<TeamId, string>>;

export function customTeamNames(teams: MatchState['teams']): CustomNames | null {
  const names: CustomNames = {};
  for (const team of ['a', 'b'] as const) {
    const name = teams[team].name;
    if (name !== DEFAULT_TEAM_NAMES[team]) names[team] = name;
  }
  return names.a === undefined && names.b === undefined ? null : names;
}

/** What the new match dialog can take along. Each box is shown only when there is something to take. */
export interface CarryOffer {
  readonly phones: boolean;
  readonly names: CustomNames | null;
  /** Both boxes start ticked when the last score change was at most an hour ago. */
  readonly selected: boolean;
}

export function carryOffer(plan: NewMatchPlan, teams: MatchState['teams']): CarryOffer {
  return { phones: plan.askCarry, names: customTeamNames(teams), selected: plan.carrySelected };
}

export function hasCarry(offer: CarryOffer): boolean {
  return offer.phones || offer.names !== null;
}

export interface CarryChoice {
  readonly phones: boolean;
  readonly names: boolean;
}

/**
 * The new match starts with Team A and Team B. Kept names are renames at the same instant,
 * so the new match still counts as blank until a score or a later change.
 */
export function commitNewMatch(
  plan: NewMatchPlan,
  at: number,
  by: string,
  names: CustomNames | null = null,
): NewMatchCommit {
  const created: MatchEvent = {
    type: 'match/new',
    matchId: createMatchId(),
    at: plan.kind === 'finish' ? at + 1 : at,
    by,
  };
  const renames: MatchEvent[] = [];
  for (const team of ['a', 'b'] as const) {
    const name = names?.[team];
    if (typeof name === 'string' && name !== DEFAULT_TEAM_NAMES[team]) {
      renames.push({ type: 'team/rename', team, name, at: created.at, by });
    }
  }
  if (plan.kind === 'finish') {
    return { endOnServer: true, events: [{ type: 'match/end', at, by }, created, ...renames] };
  }
  return { endOnServer: false, events: [created, ...renames] };
}

export function carryLabels(names: CustomNames): { readonly phones: string; readonly phonesHint: string; readonly names: string } {
  const shown = [names.a ?? DEFAULT_TEAM_NAMES.a, names.b ?? DEFAULT_TEAM_NAMES.b].join(' · ');
  return {
    phones: 'Take the connected phones along',
    phonesHint: 'They follow on their own and are not asked. An offline phone follows when it reconnects, while its code is still valid.',
    names: `Keep team names (${shown})`,
  };
}

export function newMatchCopy(plan: NewMatchPlan, offer?: CarryOffer): {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly confirmTestId: string;
} {
  const keepsNames = offer?.names != null;
  if (plan.kind === 'finish') {
    return {
      title: 'Finish current match and start a new one?',
      body: 'The current match ends and is kept in History. You can reopen it.',
      confirmLabel: 'Finish & new',
      confirmTestId: 'finish-and-new',
    };
  }
  if (plan.kind === 'leave') {
    return {
      title: 'Start your own match?',
      body: 'You leave the shared match on this phone. The host match stays open.',
      confirmLabel: 'New match',
      confirmTestId: 'confirm-leave',
    };
  }
  return {
    title: 'New match?',
    body: keepsNames
      ? 'The score is reset.'
      : 'The score is reset. Team names go back to Team A and Team B.',
    confirmLabel: 'Reset',
    confirmTestId: 'confirm-reset',
  };
}
