/**
 * Squish's service worker.
 *
 * Its only job is meal reminders. It deliberately does not cache anything:
 * an offline cache that serves a stale build is a class of bug that is
 * miserable to diagnose from a bug report, and the app already degrades
 * gracefully without a network.
 */

// A new worker should take over straight away rather than waiting for every
// tab to close — reminders that need a version the user has not got yet are
// worse than a moment's disruption.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'Squish';
  const body = payload.body || 'Time to log a meal.';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // One reminder replaces the last rather than stacking: three unread
      // nudges is nagging, and nagging gets notifications turned off.
      tag: 'squish-reminder',
      renotify: true,
      data: { meal: payload.meal ?? null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Open the camera straight away — the reminder and the thing it is asking
  // for should be one tap apart, not two.
  const target = '/?log=1';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
