import type { NewMatchPlan } from '@padel/core';
import { createMatchId } from './id';
import type { MatchEvent } from './types';

export interface NewMatchCommit {
  readonly events: readonly MatchEvent[];
  /** The host ends the shared match. Leaving or resetting a blank court does not. */
  readonly endOnServer: boolean;
}

export function commitNewMatch(plan: NewMatchPlan, at: number, by: string): NewMatchCommit {
  const created: MatchEvent = {
    type: 'match/new',
    matchId: createMatchId(),
    at: plan.kind === 'finish' ? at + 1 : at,
    by,
  };
  if (plan.kind === 'finish') {
    return { endOnServer: true, events: [{ type: 'match/end', at, by }, created] };
  }
  return { endOnServer: false, events: [created] };
}

export function newMatchCopy(plan: NewMatchPlan): {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly confirmTestId: string;
  readonly alternateLabel?: string;
  readonly alternateTestId?: string;
} {
  if (plan.askCarry) {
    const alone = plan.kind === 'leave'
      ? 'No leaves the shared match on this phone only.'
      : 'No ends this match and starts the new one on this phone only.';
    return {
      title: 'Take the connected phones into the new match?',
      body: `Yes moves every phone that already joined. They follow this match on their own and are not asked. A phone that is offline follows when it reconnects, while its code is still valid. ${alone}`,
      confirmLabel: 'Take phones',
      confirmTestId: 'take-phones',
      alternateLabel: 'Just this phone',
      alternateTestId: 'new-match-alone',
    };
  }
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
    body: 'The score is reset. Team names go back to Team A and Team B.',
    confirmLabel: 'Reset',
    confirmTestId: 'confirm-reset',
  };
}
