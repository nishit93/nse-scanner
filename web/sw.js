// App shell is cached for offline/instant start; data is network-first so scans stay fresh.
const CACHE = "nse-scanner-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const networkFirst = url.origin !== location.origin || url.pathname.includes("/data/");
  e.respondWith(networkFirst ? fromNetwork(req) : fromCache(req));
});

async function fromNetwork(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw new Error("offline");
  }
}

async function fromCache(req) {
  const hit = await caches.match(req);
  const refresh = fetch(req).then(async (res) => {
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || refresh;
}
