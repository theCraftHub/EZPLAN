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
import { CLIENT_IP_HEADER } from "@rakuplan/server";

interface App {
  fetch(request: Request): Response | Promise<Response>;
}

const LIVE_PATH = /^\/api\/plans\/[^/]+\/live$/;

/**
 * The client's address comes from the connection (or, with `trustProxy`, from the first
 * X-Forwarded-For entry a reverse proxy adds); anything the client sent itself is dropped.
 */
function withClientIp(request: Request, incoming: IncomingMessage | undefined, trustProxy: boolean): Request {
  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  headers.delete(CLIENT_IP_HEADER);
  const forwarded = trustProxy ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  const ip = forwarded || incoming?.socket.remoteAddress;
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(request, { headers });
}

export function startServer(opts: { app: App; rooms: MemoryRoomHost; port: number; hostname?: string; trustProxy?: boolean; onListen?: (port: number) => void }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIVE_MAX_MESSAGE });
  const fetch = (request: Request, env: unknown) => opts.app.fetch(withClientIp(request, (env as { incoming?: IncomingMessage } | undefined)?.incoming, !!opts.trustProxy));
  const server = serve({ fetch, port: opts.port, ...(opts.hostname ? { hostname: opts.hostname } : {}) }, (info) => opts.onListen?.(info.port)) as Server;

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
      headers.delete("cf-connecting-ip");
      headers.set(CLIENT_IP_HEADER, (opts.trustProxy && req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim()) || req.socket.remoteAddress || "unknown");
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
