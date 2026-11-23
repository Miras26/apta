/* Апта — offline cache. Pages load from the network first, so a published fix
   arrives on the next launch; with no connection the saved copy opens instead. */
const VERSION = 'apta-20261124013951';
const CORE = ['./', './index.html', './support.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable.png',
  './Main.dc.html', './Dark.dc.html', './CalLight.dc.html', './CalDark.dc.html', './CalHabits.dc.html', './CalHabitsDark.dc.html',
  './FinLight.dc.html', './FinDark.dc.html', './ProfLight.dc.html', './ProfDark.dc.html', './NotesLight.dc.html', './NotesDark.dc.html',
  './NotesDiary.dc.html', './NotesDiaryDark.dc.html', './NotesMap.dc.html', './NotesMapLight.dc.html',
  './OnboardLight.dc.html', './OnboardDark.dc.html', './AuthLight.dc.html', './AuthDark.dc.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !fonts) return;
  if (fonts) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); return res; })));
    return;
  }
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); } return res; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./index.html');
  }));
});
