-- One minute of POST /join attempts. A device row uses 20. A network row uses 60.
-- The check rejects the increment that would pass the cap, so both counters roll back together.
-- subject_hash is an HMAC, not the device id or the network address.

CREATE TABLE IF NOT EXISTS join_quota (
  subject_hash TEXT NOT NULL,
  window INTEGER NOT NULL,
  n INTEGER NOT NULL,
  cap INTEGER NOT NULL,
  PRIMARY KEY (subject_hash, window),
  CHECK (n >= 0 AND n <= cap)
);
