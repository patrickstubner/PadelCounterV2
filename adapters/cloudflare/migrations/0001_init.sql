-- Match index for a later login and history. Live scoring does not read this database yet.
-- The Durable Object for a match is the source of truth for the open game.

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_activity ON matches (last_activity);
