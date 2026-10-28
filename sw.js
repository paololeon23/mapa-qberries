const CACHE = "qb-v81";
const SHELL = [
  "./",
  "./index.html",
  "./form.html",
  "./config.js",
  "./api.js",
  "./data.js",
  "./data.js?v=8",
  "./manifest.webmanifest",
  "./assets/logo-qberries.png",
  "./assets/icon-192.png",
  "./assets/apple-touch-icon.png"
];

function isShellPath(pathname) {
  return (
    pathname === "/" ||
    pathname.endsWith("/") ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".webmanifest") ||
    pathname.includes("/assets/")
  );
}

async function putInCache(request, response) {
  if (!response || !response.ok || response.type === "opaque") return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
  } catch (e) { /* ignore */ }
}

self.addEventListener("message", e => {
  const data = e.data || {};
  if (data.type === "PURGE") {
    e.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

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

  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    const shell = isShellPath(url.pathname);

    function fetchTimeout(ms) {
      return new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), ms));
    }

    // Shell: red primero, pero si hay caché no espera más de ~0.8s
    if (shell) {
      try {
        const net = await Promise.race([
          fetch(e.request, { cache: "no-store" }),
          fetchTimeout(cached ? 800 : 8000)
        ]);
        if (net && net.ok && net.type !== "opaque") {
          const copy = net.clone();
          e.waitUntil(putInCache(e.request, copy));
          return net;
        }
      } catch (err) { /* offline, lenta o timeout */ }
      if (cached) return cached;
    }

    try {
      const res = await fetch(e.request);
      if (res && res.ok && res.type !== "opaque") {
        const copy = res.clone();
        e.waitUntil(putInCache(e.request, copy));
      }
      return res;
    } catch (err) {
      if (cached) return cached;
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
