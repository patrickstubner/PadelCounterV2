import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { TEST_QUOTA_HMAC_KEY } from './src/tokens.ts';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          QUOTA_HMAC_KEY: TEST_QUOTA_HMAC_KEY,
          TEST_MIGRATIONS: await readD1Migrations(path.join(root, 'migrations')),
        },
      },
    })),
  ],
  test: {
    include: ['src/**/*.worker.test.ts'],
    setupFiles: ['./src/worker-setup.ts'],
  },
});
