const cacheName = "fx-domain-shell-local-build-" + self.registration.scope;
const shell = [
  "./",
  "./index.html",
  "./app.js",
  "./alerts-ui.js",
  "./trends.js",
  "./model.js",
  "./manifest.json",
  "./icon192.png",
  "./icon512.png",
].map(path => new URL(path,self.registration.scope).pathname);
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(shell.map(path => new Request(path, {cache: "reload"}))))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("fx-domain-shell-") && (name.endsWith(self.registration.scope) || (self.registration.scope === self.location.origin + "/" && /^fx-domain-shell-v\d+$/.test(name))) && name !== cacheName)
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




self.addEventListener("push", event => {
  const payload=event.data.json();
  if(payload.type==="test") {
    event.waitUntil(self.registration.showNotification("FX Domain test notification",{body:"Gap alerts can reach this device.",icon:"./icon192.png"}));
    return;
  }
  const {pair,frame,threshold,gap} = payload;
  const period = ["","Daily","Weekly","Monthly","Quarter","Half year","Year","Year to date","Month to date"][frame];
  event.waitUntil(self.registration.showNotification(pair+" · "+period+" gap alert", {
    body:"Absolute gap "+(payload.direction==="down"?"fell":"rose")+" to "+gap.toFixed(2)+" pp (threshold "+threshold.toFixed(2)+" pp).",
    icon:"./icon192.png"
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(self.registration.scope));
});
