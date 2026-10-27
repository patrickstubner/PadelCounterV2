-- Daily create quota, hashed join credentials, and one-use websocket tickets.
-- A live room stops taking scores one day after the last event. That check
-- does not delete this row. The scheduled job deletes a match two years
-- after last_activity.

CREATE TABLE IF NOT EXISTS create_quota (
  address_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (address_hash, day)
);

CREATE TABLE IF NOT EXISTS credentials (
  token_hash TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  host INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_credentials_match ON credentials (match_id);

CREATE TABLE IF NOT EXISTS tickets (
  ticket_hash TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
