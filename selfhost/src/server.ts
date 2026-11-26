/**
 * The self-hosted HTTP server: the app on @hono/node-server, plus WebSocket upgrades for live
 * editing. An upgrade first goes through the app's /live route (sign-in, workspace access, origin
 * check); only then is the socket accepted and handed to the plan's room.
 */
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { serve } from "@hono/node-server";
import { LIVE_MAX_MESSAGE } from "@rakuplan/shared";
import { WebSocketServer } from "ws";
import { INTERNAL_UPGRADE_HEADER, type MemoryRoomHost } from "./adapters";

interface App {
  fetch(request: Request): Response | Promise<Response>;
}

const LIVE_PATH = /^\/api\/plans\/[^/]+\/live$/;

export function startServer(opts: { app: App; rooms: MemoryRoomHost; port: number; hostname?: string; onListen?: (port: number) => void }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIVE_MAX_MESSAGE });
  const server = serve({ fetch: opts.app.fetch, port: opts.port, ...(opts.hostname ? { hostname: opts.hostname } : {}) }, (info) => opts.onListen?.(info.port)) as Server;

  const refuse = (socket: Duplex, status: number, body: string) => {
    socket.end(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Error"}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  };

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const path = (req.url ?? "/").split("?")[0]!;
      if (!LIVE_PATH.test(path)) return refuse(socket, 404, JSON.stringify({ error: "Not found." }));
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      headers.set(INTERNAL_UPGRADE_HEADER, opts.rooms.upgradeSecret); // overwrites anything a client sent
      const res = await opts.app.fetch(new Request(`http://localhost${req.url}`, { method: "GET", headers }));
      const ticket = res.headers.get("x-live-ticket");
      if (res.status !== 200 || !ticket) return refuse(socket, res.status, await res.text());
      wss.handleUpgrade(req, socket, head, (ws) => opts.rooms.attach(ticket, ws));
    })().catch(() => refuse(socket, 500, JSON.stringify({ error: "Something went wrong on our side." })));
  });

  return {
    server,
    port: () => (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        opts.rooms.closeAll();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
