self.addEventListener('install', (event) => {
  console.log('JewelryFlow Service Worker oʻrnatildi');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('JewelryFlow Service Worker faollashdi');
});

self.addEventListener('fetch', (event) => {
  // PWA talabiga javob berish uchun oddiy fetch ushlagich
});