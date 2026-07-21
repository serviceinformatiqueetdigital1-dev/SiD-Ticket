// Service worker minimal — nécessaire pour que le navigateur propose
// "Installer l'application" / "Ajouter à l'écran d'accueil".
// Ne met rien en cache pour l'instant : les données restent toujours à jour.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
