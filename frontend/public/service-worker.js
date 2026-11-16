const CACHE_NAME = "finanflow-pwa-v4";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/finanflow-180.png",
  "/icons/finanflow-192.png",
  "/icons/finanflow-512.png",
  "/icons/finanflow-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Versioned build assets are immutable: avoid a network round trip on each opening.
  if (/^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|webp|svg)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then(async cached => {
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())).catch(() => undefined);
      return response;
    }));
    return;
  }
  // Only navigations may fall back to the HTML shell. Never return HTML for missing scripts.
  if (request.mode === "navigate" || url.pathname.endsWith(".html")) {
    event.respondWith(fetch(request, { cache: "no-store" }).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())).catch(() => undefined);
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match("/"))));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())).catch(() => undefined);
      return response;
    }))
  );
});
