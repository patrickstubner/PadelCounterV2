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
 * Spectators cannot change the match. Issuing a QR is host-only, and still only for a player host.
 * A spectator is never a host.
 */
export function canPerform(credential: Credential, action: MatchAction): boolean {
  if (credential.role === 'spectator') return false;
  if (action === 'issue_invite') return credential.host;
  return true;
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
