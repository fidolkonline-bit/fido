/* Fido service worker: makes the app installable, shows an offline screen instead of the browser's error page,
   and turns Web Push messages into task notifications.
   Deliberately caches no pages, API answers or server actions: stock, money and tasks always come live from
   the server (spec §23), and a shared shop device must not keep one person's screens for the next. */

const VERSION = "fido-sw-1";
const SHELL = `${VERSION}-shell`;
const OFFLINE_URL = "/offline.html";
const SHELL_FILES = [OFFLINE_URL, "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    // Network first, always. Only when the network is unreachable show the offline screen.
    event.respondWith((async () => {
      try {
        return (await event.preloadResponse) || (await fetch(req));
      } catch {
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }
  if (SHELL_FILES.includes(new URL(req.url).pathname)) event.respondWith(caches.match(req).then((r) => r || fetch(req)));
  // Everything else goes straight to the network (the browser's own HTTP cache still applies).
});

// ───── Push ─────

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || "Fido";
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,
    renotify: !!data.tag, // a repeat for the same task alerts again instead of updating silently
    requireInteraction: !!data.urgent, // stays on screen until tapped (Windows / Android desktop)
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    vibrate: data.urgent ? [300, 120, 300, 120, 300] : [200],
    timestamp: Date.now(),
    data: { url: data.url || "/" },
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Open copies of the app refresh their alert list now instead of on the next 15-second poll.
    for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "fido:poll" });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => w.url === url) || wins[0];
    if (win) {
      if (win.url !== url && "navigate" in win) await win.navigate(url).catch(() => undefined);
      return win.focus();
    }
    return self.clients.openWindow(url);
  })());
});

// The browser rotated the push subscription: register the new one for the same login.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const options = event.oldSubscription && event.oldSubscription.options;
    const sub = event.newSubscription || (options && (await self.registration.pushManager.subscribe(options)));
    if (!sub) return;
    await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()), credentials: "same-origin" });
  })());
});
