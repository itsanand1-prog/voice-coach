// Registers the offline service worker (sw.js, next to the pages).
// Browsers only allow it on https or on this computer (localhost).

export function registerServiceWorker() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && !local)) return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline support unavailable:', err.message));
}
