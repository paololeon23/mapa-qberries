const CACHE = "qb-v2";
const SHELL = [
  "./",
  "./index.html",
  "./form.html",
  "./config.js",
  "./api.js",
  "./data.js",
  "./manifest.webmanifest",
  "./assets/logo-qberries.png",
  "./assets/icon-192.png",
  "./assets/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => Promise.all(
        SHELL.map(u => c.add(u).catch(() => null))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached);

      // App shell: cache primero para offline instantáneo
      if (cached && (
        url.pathname.endsWith(".html") ||
        url.pathname.endsWith(".js") ||
        url.pathname.endsWith(".webmanifest") ||
        url.pathname.includes("/assets/")
      )) {
        return cached;
      }
      return fetchPromise.then(res => res || cached);
    })
  );
});
