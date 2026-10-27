declare namespace Cloudflare {
  interface Env {
    MATCH_ROOMS: DurableObjectNamespace;
    DB: D1Database;
    ENVIRONMENT: string;
    QUOTA_HMAC_KEY: string;
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
  interface GlobalProps {
    mainModule: typeof import('./index');
  }
}
