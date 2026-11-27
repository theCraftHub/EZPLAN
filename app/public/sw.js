// Offline shell: pages and built files are cached so the app opens without a connection.
// The API is never cached here; the app keeps its own offline copies of plans (lib/offline.ts).
const CACHE = "shell-v2";
// The page and every built file it references are cached at install, so the app opens offline
// even if the first visit ended before those files passed through this worker.
async function cacheShell() {
  const c = await caches.open(CACHE);
  const page = await fetch("/", { cache: "no-store" });
  const html = await page.clone().text();
  const built = [...new Set([...html.matchAll(/\/assets\/[^"'\s>]+/g)].map((m) => m[0]))];
  await c.put("/", page);
  await c.addAll(["/icon.svg", "/manifest.webmanifest", ...built]);
}
self.addEventListener("install", (e) => {
  e.waitUntil(cacheShell().then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  if (e.request.mode === "navigate") {
    // Network first for pages, so a new release shows at once; the cached shell when offline.
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return r; }).catch(() => caches.match("/")));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    // Built files have content hashes in their names, so a cached copy is always right.
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })));
  }
});
