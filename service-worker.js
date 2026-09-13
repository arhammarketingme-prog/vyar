// Minimal service worker. It doesn't cache anything yet (every request
// just passes through to the network) — this exists mainly so browsers
// recognize VYRA as installable. Add real offline caching here later if
// you want the app to work without a connection.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
