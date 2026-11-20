// BullConvert service worker: РїСЂРёР»РѕР¶РµРЅРёРµ РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ Р±РµР· СЃРµС‚Рё,
// Р° Р±РёР±Р»РёРѕС‚РµРєРё СЃ CDN РїРѕСЃР»Рµ РїРµСЂРІРѕРіРѕ РёСЃРїРѕР»СЊР·РѕРІР°РЅРёСЏ Р±РµСЂСѓС‚СЃСЏ РёР· РєСЌС€Р°.
const VERSION = 'bc-v21';
const SHELL = `${VERSION}-shell`;
const LIBS = `${VERSION}-libs`;
const SHELL_FILES = [
  './', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest',
  'bullconvert.svg', 'bullconvert.ico', 'icon-192.png', 'icon-512.png', 'pdftools.js', 'extras.js', 'i18n.js', 'office.js', 'docx.js', 'math.js', 'sign.js', 'xlsx.js', 'scan.js', 'dxf.js', 'privacy.html', 'site-config.js',
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

  // API СЃРµСЂРІРµСЂР° (РљРћРњРџРђРЎ, Р°СЂС…РёРІС‹) вЂ” С‚РѕР»СЊРєРѕ РїРѕ СЃРµС‚Рё
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  // РЎРІРѕРё С„Р°Р№Р»С‹: СЃРЅР°С‡Р°Р»Р° СЃРµС‚СЊ (С‡С‚РѕР±С‹ РѕР±РЅРѕРІР»РµРЅРёСЏ РїСЂРёС…РѕРґРёР»Рё СЃСЂР°Р·Сѓ), Р±РµР· СЃРµС‚Рё вЂ” РєСЌС€
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

  // Р‘РёР±Р»РёРѕС‚РµРєРё СЃ CDN: РІРµСЂСЃРёРё Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅС‹ вЂ” РєСЌС€, РёРЅР°С‡Рµ СЃРµС‚СЊ
  // staticimgly.com вЂ” РјРѕРґРµР»СЊ РЅРµР№СЂРѕСЃРµС‚Рё РґР»СЏ СѓРґР°Р»РµРЅРёСЏ С„РѕРЅР°
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
