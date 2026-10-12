self.addEventListener("install", (_event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (_event) => {
  // Service worker activated
});

self.addEventListener("fetch", (_event) => {
  // PWA talabiga javob berish uchun oddiy fetch ushlagich
});