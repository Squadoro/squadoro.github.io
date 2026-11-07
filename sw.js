/* Squadoro : fonctionnement hors ligne. Les pages et les DCE sont cherchés sur le réseau d'abord, puis dans le cache. */
const CACHE = 'squadoro-202611070758';
const SHELL = ['./', 'index.html', 'privacy.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'catalog.json', 'market.json',
  'fonts/barlow-regular.woff', 'fonts/barlow-medium.woff', 'fonts/barlow-semibold.woff', 'fonts/barlow-bold.woff',
  'fonts/barlowcondensed-semibold.woff', 'fonts/barlowcondensed-bold.woff', 'fonts/barlowcondensed-bolditalic.woff', 'fonts/barlowcondensed-extrabolditalic.woff'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // bases des joueurs et des cartes spéciales FC 27 (fichiers qui changent au plus une fois par jour) : la copie en cache sert tout de suite, la nouvelle version est chargée en fond pour la visite suivante
  if (/(players|specials)-fc27\.json$/.test(url.pathname)) {
    const cached = caches.match(url.pathname);
    const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); return caches.open(CACHE).then((c) => c.put(url.pathname, copy)).then(() => res); } return res; });
    e.respondWith(cached.then((r) => r || net));
    e.waitUntil(net.then(() => {}, () => {}));
    return;
  }
  const fresh = req.mode === 'navigate' || /\.(html|json)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (fresh) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); }
      return res;
    }).catch(() => caches.match(url.pathname).then((r) => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
