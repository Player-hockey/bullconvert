// BullConvert service worker: приложение открывается без сети,
// а библиотеки из vendor/ после первого использования берутся из кэша.
const VERSION = 'bc-v28';
const SHELL = `${VERSION}-shell`;
// Библиотеки в vendor/ лежат по путям с номером версии — их кэш не сбрасывается при обновлении
const LIBS = 'bc-vendor-1';
const SHELL_FILES = [
  './', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest',
  'bullconvert.svg', 'bullconvert.ico', 'icon-192.png', 'icon-512.png', 'pdftools.js', 'extras.js', 'i18n.js', 'office.js', 'docx.js', 'formats.js', 'formats2.js', 'math.js', 'sign.js', 'xlsx.js', 'scan.js', 'dxf.js', 'privacy.html', 'consent.html', 'site-config.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION) && k !== LIBS) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Изоляция страницы (COOP/COEP): нейросети считают сразу на всех ядрах процессора — в разы быстрее.
// GitHub Pages таких заголовков не отдаёт, поэтому добавляем их здесь.
function isolate(res) {
  if (!res || res.type === 'opaque' || res.status === 0 || res.headers.get('Cross-Origin-Embedder-Policy')) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API сервера (КОМПАС, архивы) — только по сети
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  // Библиотеки, шрифты и модели (vendor/): версии зафиксированы в путях — сначала кэш
  if (url.origin === location.origin && url.pathname.includes('/vendor/')) {
    e.respondWith((async () => {
      const cached = await caches.match(req, { cacheName: LIBS });
      if (cached) return isolate(cached);
      const res = await fetch(req);
      if (res.ok && res.status === 200) (await caches.open(LIBS)).put(req, res.clone());
      return isolate(res);
    })());
    return;
  }

  // Свои файлы: сначала сеть (чтобы обновления приходили сразу), без сети — кэш
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return isolate(res);
      } catch {
        return isolate((await caches.match(req, { ignoreSearch: true })) || (await caches.match('index.html')));
      }
    })());
    return;
  }
});
