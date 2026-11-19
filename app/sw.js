const cacheName = "fx-domain-shell-v8";
const shell = [
  "/",
  "/app.js",
  "/model.js",
  "/manifest.json",
  "/icon192.png",
  "/icon512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(shell))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("fx-domain-shell-") && name !== cacheName)
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !shell.includes(url.pathname)
  )
    return;
  event.respondWith(
    fetch(event.request).catch(async () =>
      (await caches.open(cacheName)).match(url.pathname),
    ),
  );
});


