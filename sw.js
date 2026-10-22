// Offline shell: the app's own files are served cache-first. Commander art
// from Scryfall is cached on first view so tiles keep it offline; Scryfall
// API calls go straight to the network, the tracker never needs them.
const CACHE = "ct-v12";
const ART = "ct-art-v1";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "manifest.webmanifest",
  "js/i18n.js",
  "js/store.js",
  "js/game.js",
  "js/stats.js",
  "js/decks.js",
  "js/recap.js",
  "js/sound.js",
  "js/usage.js",
  "js/share.js",
  "js/app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== ART).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "cards.scryfall.io") {
    e.respondWith(
      caches.open(ART).then((c) =>
        c.match(req).then((hit) => hit || fetch(req).then((res) => (c.put(req, res.clone()), res)))
      )
    );
    return;
  }
  if (url.origin !== location.origin) return;
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
