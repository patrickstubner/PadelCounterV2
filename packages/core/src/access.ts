/** Live-match roles. Spectator exists so a later read-only QR can use the same checks. */
export type Role = 'player' | 'spectator';

export type MatchAction =
  | 'score'
  | 'rename'
  | 'select_set'
  | 'serve'
  | 'end_match'
  | 'resume_match'
  | 'issue_invite';

export interface Credential {
  readonly role: Role;
  /** The device that created the match. Joiners are players without this flag. */
  readonly host: boolean;
}

export function isRole(value: unknown): value is Role {
  return value === 'player' || value === 'spectator';
}

/**
 * Server-side permission check.
 * Spectators cannot change the match or show a code. Any admitted player may show the shared code.
 * A spectator is never treated as a host.
 */
export function canPerform(credential: Credential, action: MatchAction): boolean {
  if (credential.role !== 'player') return false;
  switch (action) {
    case 'score':
    case 'rename':
    case 'select_set':
    case 'serve':
    case 'end_match':
    case 'resume_match':
    case 'issue_invite':
      return true;
    default:
      return false;
  }
}

export function actionForEvent(type: string): MatchAction | null {
  switch (type) {
    case 'game/increment':
    case 'game/decrement':
      return 'score';
    case 'team/rename':
      return 'rename';
    case 'set/select':
      return 'select_set';
    case 'serve/set':
      return 'serve';
    case 'match/end':
      return 'end_match';
    case 'match/resume':
      return 'resume_match';
    case 'match/new':
    case 'match/reset':
      return 'score';
    default:
      return null;
  }
}
