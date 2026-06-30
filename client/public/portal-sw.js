/* Service worker do Portal do Cliente CBC: push + fallback offline */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { corpo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'CBC Advogados', {
    body: d.corpo || 'Há uma novidade no seu caso. Toque para ver.',
    icon: '/favicon.png',
    badge: '/favicon.png',
    data: { url: d.url || '/portal' },
    tag: d.tag || 'cbc-novidade',
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/portal';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].url.indexOf('/portal') >= 0 && 'focus' in lista[i]) return lista[i].focus();
    }
    return self.clients.openWindow(url);
  }));
});

/* offline: navegações usam rede primeiro; sem rede, a última cópia salva */
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(
    fetch(e.request).then(function (r) {
      var copia = r.clone();
      caches.open('cbc-portal-v1').then(function (c) { c.put(e.request, copia); });
      return r;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || caches.match('/portal'); });
    })
  );
});
