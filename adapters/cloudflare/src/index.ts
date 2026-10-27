import { MatchRoom } from './match-room';
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
} satisfies ExportedHandler<Env>;
