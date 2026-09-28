/* Avatar Planning — service worker (sits next to index.html on GitHub Pages)
   1) installable app + opens offline: the page is fetched NETWORK-FIRST (always the newest version when
      online — a cached old copy must never run while online, old code could write stale data); the cached
      copy is used only when there is no connection.
   2) web push: shows notifications sent by the Supabase Edge Function "send-push" even when the app is
      closed (iPad: only when installed to the Home Screen, iPadOS 16.4+).
   Supabase / Google Drive / Apps Script requests are NOT touched. */
const CACHE = "avatar-planning-v1";
const SHELL = ["./", "manifest.webmanifest", "apple-touch-icon.png", "icon-192.png"];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // the app page itself (not request.html etc.): network first, cached copy only when offline
  if (req.mode === "navigate" && url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname)) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./", copy)); }
      return res;
    }).catch(() => caches.match("./").then(r => r || caches.match(req))));
    return;
  }
  // libraries from the CDN (supabase-js, PDF.js): network first, cache as offline fallback
  if (CDN.test(req.url)) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req)));
  }
  // everything else (Supabase, Drive, Apps Script, images) → browser default
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Avatar Planning";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = wins.find(w => w.url.startsWith(self.registration.scope));
    if (app) {
      const q = new URL(target).searchParams;
      app.postMessage({ type: "open-task", board: q.get("board") || "", task: q.get("task") || "" });
      return app.focus();
    }
    return self.clients.openWindow(target);
  })());
});
