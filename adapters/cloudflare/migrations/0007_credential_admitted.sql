-- A scanned code counts toward the mint cap only after the phone says hello.
-- Existing rows were already in use, so they stay admitted.

ALTER TABLE credentials ADD COLUMN admitted INTEGER NOT NULL DEFAULT 1;
