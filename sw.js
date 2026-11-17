// BullConvert service worker: приложение открывается без сети,
// а библиотеки с CDN после первого использования берутся из кэша.
const VERSION = 'bc-v7';
const SHELL = `${VERSION}-shell`;
const LIBS = `${VERSION}-libs`;
const SHELL_FILES = [
  './', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest',
  'bullconvert.svg', 'bullconvert.ico', 'icon-192.png', 'icon-512.png', 'access.html', 'pdftools.js', 'extras.js', 'i18n.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API сервера (КОМПАС, архивы) — только по сети
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  // Свои файлы: сначала сеть (чтобы обновления приходили сразу), без сети — кэш
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('index.html'));
      }
    })());
    return;
  }

  // Библиотеки с CDN: версии зафиксированы — кэш, иначе сеть
  // staticimgly.com — модель нейросети для удаления фона
  if (/(^|\.)(jsdelivr\.net|djvu\.js\.org|staticimgly\.com)$/.test(url.hostname)) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') (await caches.open(LIBS)).put(req, res.clone());
      return res;
    })());
  }
});
