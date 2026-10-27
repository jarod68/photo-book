self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Photo Book', {
      body: data.body ?? '',
      icon: '/favicon.ico',
      // one notification per album: a new digest replaces the previous one
      tag:      data.tag || undefined,
      renotify: !!data.tag,
      data: { album: data.album, photo: data.photo },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { album, photo } = event.notification.data ?? {};
  const url = album
    ? `/viewer.html?album=${encodeURIComponent(album)}${photo ? `&photo=${encodeURIComponent(photo)}` : ''}`
    : '/';
  event.waitUntil(clients.openWindow(url));
});
