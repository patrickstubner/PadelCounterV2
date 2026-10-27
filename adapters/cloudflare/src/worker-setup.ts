import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Setup runs outside per-test storage isolation and may run more than once.
// applyD1Migrations skips migrations that are already recorded.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
