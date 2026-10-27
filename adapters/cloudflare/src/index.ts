import { d1MatchIndex } from './match-index';
import { MatchRoom } from './match-room';
import { purgeExpiredHistory } from './retention';
import { handleFetch, type ServerEnv } from './server';

export { MatchRoom };

export interface Env extends ServerEnv {
  MATCH_ROOMS: DurableObjectNamespace<MatchRoom>;
  DB: D1Database;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env);
  },
  scheduled(_controller, env, ctx): void {
    ctx.waitUntil(
      purgeExpiredHistory(d1MatchIndex(env.DB), Date.now(), async (id) => {
        const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(id));
        const cleared = await stub.fetch('https://match.internal/discard', { method: 'POST' });
        if (!cleared.ok) throw new Error('discard failed');
      }),
    );
  },
} satisfies ExportedHandler<Env>;
