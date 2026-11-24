self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data;
    try {
      data = event.data?.json();
    } catch {
      // Show a notification even if the optional payload cannot be decoded.
    }
    await self.registration.showNotification(data?.title || '股票账簿', {
      body: data?.body || '有新的价格提醒',
      tag: data?.tag,
      icon: new URL('icon-192.png', self.registration.scope).href,
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = windows.find(client => client.url.startsWith(scope));
    if (app) await app.focus();
    else await self.clients.openWindow(scope);
  })());
});
