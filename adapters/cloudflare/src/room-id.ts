import { isUuid } from '@padel/core';

/**
 * D1 key for this room.
 * A UUID object name wins. Any other name is ignored, and the id stored at create is used.
 * Both forms come back lowercase. A missing name does not drop a stored id.
 */
export function resolveRoomMatchId(name: string | undefined, stored: string | null): string | null {
  if (isUuid(name)) return name.toLowerCase();
  if (isUuid(stored)) return stored.toLowerCase();
  return null;
}
