// Offline shell: the app's own files are served cache-first. Scryfall calls
// go straight to the network; the tracker never needs them.
const CACHE = "ct-v1";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "icon.svg",
  "manifest.webmanifest",
  "js/i18n.js",
  "js/store.js",
  "js/game.js",
  "js/stats.js",
  "js/app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => (req.mode === "navigate" ? caches.match("index.html") : undefined))
    )
  );
});
