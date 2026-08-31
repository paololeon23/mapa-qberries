const CACHE = "qb-v27";
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

async function refreshInBackground(request) {
  try {
    const res = await fetch(request);
    // No se reutiliza el body: put consume esta respuesta
    await putInCache(request, res);
  } catch (e) { /* offline */ }
}

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

    // Shell: responde cache al instante y actualiza en background (sin clone cruzado)
    if (cached && isShellPath(url.pathname)) {
      e.waitUntil(refreshInBackground(e.request));
      return cached;
    }

    try {
      const res = await fetch(e.request);
      if (res && res.ok && res.type !== "opaque") {
        // Clonar ANTES de devolver; put usa la copia
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
