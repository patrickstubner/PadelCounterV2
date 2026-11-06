-- Why a credential was revoked. Only 'removed' is read back; other revokes stay null.

ALTER TABLE credentials ADD COLUMN revoke_reason TEXT;
