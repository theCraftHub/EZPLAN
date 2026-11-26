/**
 * Cloud entry point (Cloudflare Workers): the shared API (server/) on the Cloudflare connectors,
 * plus the PlanRoom Durable Object for live editing.
 */
import { AnthropicEngine, configFromEnv, createApp, FakeEngine, LiveRoom, PlanRoomCore, systemClock, testAuthEnabled, type Clock, type Peer } from "@rakuplan/server";
import { LIVE_MAX_MESSAGE, type Actor, type OpEnvelope, type ServerMessage } from "@rakuplan/shared";
import { D1Db, DurableRoomHost, R2Blobs, type LiveTicket } from "./adapters";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  PLAN_ROOM: DurableObjectNamespace;
  /** The site's address and sign-in settings (secrets): see server/src/config.ts. */
  PUBLIC_URL: string;
  OIDC_PROVIDERS?: string;
  ALLOWED_EMAILS?: string;
  SECURE_COOKIES?: string;
  /** "1" only in tests: trusts the x-test-user header. Never set in production. */
  TEST_AUTH?: string;
  /** Tests only: with TEST_CLOCK=1, a fixed "today", so dates in tests don't drift. Never set in production. */
  TEST_CLOCK?: string;
  TEST_TODAY?: string;
  /** The built-in AI (secret). Without it, AI features are off. */
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
  AI_REPORT_MODEL?: string;
  /** "1" only in tests: a scripted AI engine. Never set in production. */
  TEST_AI?: string;
}

function clockFor(env: Env): Clock {
  if (env.TEST_CLOCK === "1" && env.TEST_TODAY) return { today: () => env.TEST_TODAY!, now: () => Date.parse(`${env.TEST_TODAY}T12:00:00Z`) };
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
          clock: clockFor(env),
          config: configFromEnv(env as unknown as Record<string, string | undefined>),
          http: (req) => fetch(req),
          ...(testAuthEnabled(env.TEST_AUTH) ? { testAuth: true } : {}),
          ...(testAuthEnabled(env.TEST_AI)
            ? { ai: new FakeEngine() }
            : env.ANTHROPIC_API_KEY
              ? { ai: new AnthropicEngine({ apiKey: env.ANTHROPIC_API_KEY, ...(env.AI_MODEL ? { model: env.AI_MODEL } : {}), ...(env.AI_REPORT_MODEL ? { reportModel: env.AI_REPORT_MODEL } : {}) }) }
              : {}),
        }),
      };
    }
    return cached.app.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/**
 * One plan's live room (one Durable Object per plan, worldwide). Live connections use the
 * hibernation API, so an idle room with open connections costs nothing; the signed-in person and
 * role are stored on each socket and survive hibernation.
 */
export class PlanRoom implements DurableObject {
  private live: LiveRoom | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private room(planId: string): LiveRoom {
    this.live ??= new LiveRoom(new PlanRoomCore(new D1Db(this.env.DB), planId, clockFor(this.env)), () =>
      this.state
        .getWebSockets()
        .filter((ws) => ws.readyState === WebSocket.OPEN)
        .map((ws) => this.peer(ws)),
    );
    return this.live;
  }

  private peer(ws: WebSocket): Peer {
    const t = ws.deserializeAttachment() as LiveTicket;
    return { actor: t.actor, role: t.role, send: (m) => ws.send(m), close: (code, reason) => ws.close(code, reason) };
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/apply") {
      const { planId, envelope, actor } = (await request.json()) as { planId: string; envelope: OpEnvelope; actor: Actor };
      return Response.json(await this.room(planId).applyFromApi(envelope, actor));
    }
    if (path === "/notify") {
      const { planId, message } = (await request.json()) as { planId: string; message: ServerMessage };
      this.room(planId).notify(message);
      return new Response(null, { status: 204 });
    }
    if (path === "/kick") {
      const { planId, userId } = (await request.json()) as { planId: string; userId: string };
      this.room(planId).kick(userId);
      return new Response(null, { status: 204 });
    }
    if (path === "/live") {
      // Only the Worker reaches this object; it has already checked sign-in and access.
      const ticket = JSON.parse(request.headers.get("x-live") ?? "null") as LiveTicket | null;
      if (!ticket || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Bad request", { status: 400 });
      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
      this.state.acceptWebSocket(server);
      server.serializeAttachment(ticket);
      this.room(ticket.planId).presence();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const t = ws.deserializeAttachment() as LiveTicket;
    if (typeof message !== "string" && message.byteLength > LIVE_MAX_MESSAGE) return ws.close(1009, "Message too large");
    await this.room(t.planId).message(this.peer(ws), message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const t = ws.deserializeAttachment() as LiveTicket;
    try {
      ws.close();
    } catch {
      // already closed
    }
    this.room(t.planId).presence();
  }
}
