/** Fixed sentences shared by the server and the UI. The client renders these, not free text from the network. */
export const ROOM_MESSAGES = {
  match_full: 'This match already has 4 players.',
  expired: 'This code has expired. Ask for a new one.',
  bad_token: 'This code is not valid.',
  revoked: 'This code is no longer valid. Ask for a new one.',
  spectator_not_available: 'View-only links are not available yet.',
  forbidden: 'You cannot change the score from this connection.',
  not_applied: 'That change was not applied.',
  slow_down: 'Too many changes. Wait a moment.',
  upgrade_required: 'Update the app to keep scoring.',
  unavailable: 'This match is not available.',
  not_configured: 'Live sharing is not configured in this build.',
  offline: 'The live server did not answer. The score on this device is unchanged.',
} as const;

export type RoomCode = keyof typeof ROOM_MESSAGES;

const ROOM_CODES: ReadonlySet<string> = new Set(Object.keys(ROOM_MESSAGES));

export function isRoomCode(value: unknown): value is RoomCode {
  return typeof value === 'string' && ROOM_CODES.has(value);
}
