/**
 * Cloud entry point (Cloudflare Workers): the shared API (server/) on the Cloudflare connectors,
 * plus the PlanRoom Durable Object for live editing.
 */
import { authFor, createApp, systemClock, type Clock } from "@ezplan/server";
import { DEFAULT_WORK_WEEK } from "@ezplan/shared";
import { D1Db, DurableRoomHost, R2Blobs, RoomObjectCore } from "./adapters";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  PLAN_ROOM: DurableObjectNamespace;
  /** "1" only in tests: trusts the x-test-user header. Never set in production. */
  TEST_AUTH?: string;
  /** Tests only (with TEST_AUTH=1): a fixed "today", so dates in tests don't drift. */
  TEST_TODAY?: string;
}

function clockFor(env: Env): Clock {
  if (env.TEST_AUTH === "1" && env.TEST_TODAY) return { today: () => env.TEST_TODAY!, now: () => Date.parse(`${env.TEST_TODAY}T12:00:00Z`) };
  return systemClock;
}

// One app per isolate, so migrations are checked once rather than on every request.
let cached: { env: Env; app: ReturnType<typeof createApp> } | null = null;

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    if (!cached || cached.env !== env) {
      const db = new D1Db(env.DB);
      cached = {
        env,
        app: createApp({
          db,
          blobs: new R2Blobs(env.FILES),
          rooms: new DurableRoomHost(env.PLAN_ROOM),
          auth: authFor(env.TEST_AUTH),
          clock: clockFor(env),
          config: { defaultWorkWeek: DEFAULT_WORK_WEEK },
        }),
      };
    }
    return cached.app.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class PlanRoom implements DurableObject {
  private readonly core: RoomObjectCore;

  constructor(_state: DurableObjectState, env: Env) {
    this.core = new RoomObjectCore(new D1Db(env.DB), clockFor(env));
  }

  fetch(request: Request): Promise<Response> {
    return this.core.handle(request);
  }
}
