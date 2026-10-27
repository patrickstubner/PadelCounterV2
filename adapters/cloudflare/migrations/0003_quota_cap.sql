-- Daily counters store an HMAC and a cap. A device row uses 10.
-- A network row uses 100. The check rejects the increment that would pass the cap,
-- so a batch of both counters rolls back together.

CREATE TABLE create_quota_next (
  address_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL,
  cap INTEGER NOT NULL,
  PRIMARY KEY (address_hash, day),
  CHECK (n >= 0 AND n <= cap)
);

INSERT INTO create_quota_next (address_hash, day, n, cap)
SELECT address_hash, day, n, 10 FROM create_quota;

DROP TABLE create_quota;

ALTER TABLE create_quota_next RENAME TO create_quota;
