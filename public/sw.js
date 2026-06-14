self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Photo Book', {
      body: data.body ?? '',
      icon: '/favicon.ico',
      data: { album: data.album },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const album = event.notification.data?.album;
  const url = album ? `/viewer.html?album=${encodeURIComponent(album)}` : '/';
  event.waitUntil(clients.openWindow(url));
});
