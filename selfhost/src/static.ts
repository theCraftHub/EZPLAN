/**
 * Serves the website (app/dist) next to the API. Unknown page addresses get index.html so links
 * like /p/123 open the app; /api and /auth always go to the server.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

/** Same rules as the cloud (worker/wrangler.toml): only our own scripts, no framing, no sniffing. */
export const PAGE_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
};

interface App {
  fetch(request: Request): Response | Promise<Response>;
}

export function withStatic(app: App, dir: string | undefined): App {
  if (!dir || !existsSync(join(dir, "index.html"))) return app;
  const root = normalize(dir + sep);
  const index = readFileSync(join(dir, "index.html"));
  return {
    fetch(request: Request) {
      const url = new URL(request.url);
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith("/api/") || path.startsWith("/auth/") || (request.method !== "GET" && request.method !== "HEAD")) return app.fetch(request);
      if (path.startsWith("/_")) return new Response("Not found.", { status: 404, headers: PAGE_HEADERS }); // cloud-only config files
      const file = normalize(join(root, path));
      if (file.startsWith(root) && path !== "/" && existsSync(file) && statSync(file).isFile()) {
        const hashed = path.startsWith("/assets/");
        return new Response(request.method === "HEAD" ? null : readFileSync(file), {
          headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache", ...PAGE_HEADERS },
        });
      }
      // A missing built file is a real 404; any other address is a page of the app.
      if (path.startsWith("/assets/") || extname(path)) return new Response("Not found.", { status: 404, headers: PAGE_HEADERS });
      return new Response(request.method === "HEAD" ? null : index, { headers: { "content-type": TYPES[".html"]!, "cache-control": "no-cache", ...PAGE_HEADERS } });
    },
  };
}
