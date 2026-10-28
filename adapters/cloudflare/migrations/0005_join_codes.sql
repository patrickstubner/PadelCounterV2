-- A short code is stored as a hash. It points at the current player invite.
-- New code revokes the previous row. The raw code is not in this table.

CREATE TABLE IF NOT EXISTS join_codes (
  code_hash TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_join_codes_match ON join_codes (match_id);
