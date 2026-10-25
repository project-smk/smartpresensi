/* SMART-PRESENSI — Service Worker (cache perangkat), Revisi 96
   Prinsip aman:
   - Hanya menangani permintaan GET. POST ke server Apps Script, kamera, GPS, upload foto tidak tersentuh.
   - Halaman/berkas milik sendiri: JARINGAN DULU (selalu versi terbaru), cache hanya cadangan saat offline/lambat.
   - Pustaka & font CDN: cache dulu lalu diperbarui di latar belakang (stale-while-revalidate).
   - Naikkan VERSION bila ingin memaksa semua perangkat membuang cache lama. */
const VERSION = 'sp-v96';
const CACHE_APP = 'sp-app-' + VERSION;
const CACHE_CDN = 'sp-cdn-' + VERSION;
const CDN_HOSTS = [
  'cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com',
  'fonts.googleapis.com', 'fonts.gstatic.com'
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.indexOf('sp-') === 0 && n !== CACHE_APP && n !== CACHE_CDN).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHES') event.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.indexOf('sp-') === 0).map(k => caches.delete(k)))));
});

function isCacheable(res) { return res && (res.ok || res.type === 'opaque'); }

async function networkFirst(req) {
  const cache = await caches.open(CACHE_APP);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NETWORK_TIMEOUT_MS))
    ]);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    return fetch(req);   // tidak ada cadangan: tunggu jaringan apa adanya
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_CDN);
  const hit = await cache.match(req);
  const update = (async () => {
    let res;
    try { res = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); }   // respons non-opaque (hemat kuota)
    catch (e) { res = await fetch(req); }
    if (isCacheable(res)) cache.put(req, res.clone()).catch(() => {});
    return res;
  })();
  if (hit) { update.catch(() => {}); return hit; }
  return update;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;   // jangan menyimpan SW itu sendiri
    event.respondWith(networkFirst(req));
    return;
  }
  if (CDN_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // selain itu (script.google.com, drive, dll.) -> langsung ke jaringan, tidak pernah disimpan
});
