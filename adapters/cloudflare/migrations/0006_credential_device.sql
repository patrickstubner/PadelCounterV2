-- A short-code token belongs to one device. The shared QR invite leaves this empty.

ALTER TABLE credentials ADD COLUMN device_id TEXT;
