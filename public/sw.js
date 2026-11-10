self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Photo Book', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      // one notification per album: a new digest replaces the previous one
      tag:      data.tag || undefined,
      renotify: !!data.tag,
      data: { album: data.album, photo: data.photo, url: data.url },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { album, photo, url: page } = event.notification.data ?? {};
  // a page of this site (a new article), else the album's photos
  const url = typeof page === 'string' && page.startsWith('/') && !page.startsWith('//') ? page
    : album ? `/viewer.html?album=${encodeURIComponent(album)}${photo ? `&photo=${encodeURIComponent(photo)}` : ''}`
    : '/';
  event.waitUntil(clients.openWindow(url));
});
