// H&M Herbs & Vitamins - Service Worker
// Progressive Web App functionality with offline support

const STATIC_CACHE = 'hmherbs-static-v1.0.50';
const DYNAMIC_CACHE = 'hmherbs-dynamic-v1.0.50';

// Files to cache for offline functionality
const STATIC_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/gdpr-compliance.js',
  '/ccpa-compliance.js',
  '/manifest.json',
  '/images/logo.png',
  '/images/icon-192x192.png',
  '/images/icon-512x512.png',
  '/images/products/nature-s-puls-probiotic-mega.jpg',
  // Add other critical assets
];

// API endpoints to cache
const API_CACHE_PATTERNS = [
  /\/api\/products/,
  /\/api\/categories/,
  /\/api\/health-conditions/
];

// Install event - cache static files
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('Service Worker: Caching static files');
        // Cache files individually to handle missing files gracefully
        // This prevents one missing file from failing the entire cache operation
        return Promise.allSettled(
          STATIC_FILES.map(url =>
            cache.add(url).catch(() => {
              // Silently skip files that can't be cached (e.g., missing files, CORS issues)
              // Don't log to avoid console noise - this is expected for optional files
              return null;
            })
          )
        ).then(() => {
          console.log('Service Worker: Static files cached successfully');
          return self.skipWaiting();
        });
      })
      .catch(() => {
        // Completely silent for caching errors - they're expected when files are missing
        // Individual file failures are handled above with Promise.allSettled
        // Don't log anything - just skip waiting to activate the service worker
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activated successfully');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http requests
  if (!request.url.startsWith('http')) {
    return;
  }

  // CRITICAL: Skip external resources completely - don't intercept them at all
  // This prevents CSP violations and 503 errors for external fonts, CDN, etc.
  // Check origin before any other processing
  // Get origin from registration scope or fallback to location
  let currentOrigin;
  try {
    if (self.registration && self.registration.scope) {
      currentOrigin = new URL(self.registration.scope).origin;
    } else {
      currentOrigin = self.location.origin;
    }
  } catch (e) {
    // Fallback to location.origin if registration is not available
    currentOrigin = self.location.origin;
  }

  if (url.origin !== currentOrigin) {
    // Don't call event.respondWith() - let browser handle external resources directly
    // This prevents the service worker from intercepting external requests
    return;
  }

  // Business One POS is a separate PWA under /pos/ — never intercept it with the HM Herbs SW.
  if (url.pathname === '/pos' || url.pathname.startsWith('/pos/')) {
    return;
  }

  // Full document navigations: never use handleNavigationRequest (offline 503 HTML confused DevTools + broke product.html)
  if (request.mode === 'navigate') {
    return;
  }

  // Do not intercept API or catalog images — cache-first / offline fallbacks returned synthetic 503s
  // and hid server-side fixes (e.g. /images/products/* fallback JPEG). Let the browser use the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/products/')) {
    return;
  }

  // Admin assets should always be fresh. Cache-first can leave old admin-app.js
  // in place and break newly added dashboard functions.
  if (
    url.pathname === '/admin.html' ||
    url.pathname === '/admin-app.js' ||
    url.pathname.startsWith('/admin')
  ) {
    return;
  }

  // Auth + checkout + gift card scripts must not be cache-first (stale UI logic).
  if (
    url.pathname === '/styles.css' ||
    url.pathname === '/js/checkout.js' ||
    url.pathname === '/js/customer-auth.js' ||
    url.pathname === '/js/password-toggle.js' ||
    url.pathname === '/css/password-toggle.css' ||
    url.pathname === '/js/account.js' ||
    url.pathname === '/js/visual-bug-fixes.js' ||
    url.pathname === '/js/gift-cards.js' ||
    url.pathname === '/js/hm-gift-card.js' ||
    url.pathname === '/css/hm-gift-card.css' ||
    url.pathname === '/css/gift-cards.css' ||
    url.pathname === '/gift-cards.html' ||
    url.pathname === '/gdpr-compliance.js' ||
    url.pathname === '/js/edsa-ui.js' ||
    url.pathname === '/js/edsa-booking.js' ||
    url.pathname === '/css/edsa-booking.css' ||
    url.pathname === '/js/products.js' ||
    url.pathname === '/products.html' ||
    url.pathname === '/js/edsa-confirmation.js' ||
    url.pathname === '/js/edsa-manage-appointment.js' ||
    url.pathname === '/edsa-confirmation.html' ||
    url.pathname === '/edsa-manage-appointment.html' ||
    url.pathname === '/order-confirmation.html'
  ) {
    return;
  }

  // Handle different types of requests (only same-origin requests reach here)
  if (isStaticAsset(request)) {
    event.respondWith(handleStaticAsset(request));
  } else if (isAPIRequest(request)) {
    event.respondWith(handleAPIRequest(request));
  } else if (isNavigationRequest(request)) {
    event.respondWith(handleNavigationRequest(request));
  } else {
    event.respondWith(handleOtherRequests(request));
  }
});

// Check if request is for a static asset
function isStaticAsset(request) {
  const url = new URL(request.url);
  return url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/);
}

// Check if request is for API
function isAPIRequest(request) {
  return API_CACHE_PATTERNS.some(pattern => pattern.test(request.url));
}

// Check if request is for navigation
function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

// Handle static assets (cache first strategy)
async function handleStaticAsset(request) {
  try {
    // External resources should never reach here (filtered in fetch event listener)
    // But add a safety check just in case
    const url = new URL(request.url);
    let currentOrigin;
    try {
      if (self.registration && self.registration.scope) {
        currentOrigin = new URL(self.registration.scope).origin;
      } else {
        currentOrigin = self.location.origin;
      }
    } catch (e) {
      currentOrigin = self.location.origin;
    }
    if (url.origin !== currentOrigin) {
      // This shouldn't happen, but if it does, let browser handle it
      return fetch(request, { redirect: 'follow' });
    }

    const cachedResponse = await caches.match(request);
    if (cachedResponse && cachedResponse.ok && cachedResponse.type === 'basic') {
      return cachedResponse;
    }

    const networkResponse = await fetch(request, { redirect: 'follow' });
    if (networkResponse.ok && networkResponse.type === 'basic' && !networkResponse.redirected) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Retry a plain network fetch — returning a 503 text body breaks <img> and triggers
    // error cascades (browser tries to decode HTML/plain as an image).
    try {
      return await fetch(request, { redirect: 'follow' });
    } catch (e2) {
      return new Response('Asset not available offline', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
}

// Handle API requests (network only — never cache commerce data)
async function handleAPIRequest(request) {
  try {
    return await fetch(request, { redirect: 'follow', cache: 'no-store' });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Network unavailable',
      offline: true
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Handle navigation requests (network first, then cache, then offline page)
async function handleNavigationRequest(request) {
  try {
    const networkResponse = await fetch(request, { redirect: 'follow' });
    return networkResponse;
  } catch (error) {
    // Silently fall back to cache - this is expected behavior when offline
    // Don't log to reduce console noise
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline page
    const offlinePage = await caches.match('/');
    if (offlinePage) {
      return offlinePage;
    }

    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>H&M Herbs - Offline</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #f9fafb;
            color: #374151;
          }
          .offline-container {
            max-width: 400px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .offline-icon {
            font-size: 48px;
            color: #9ca3af;
            margin-bottom: 20px;
          }
          h1 { color: #10b981; margin-bottom: 20px; }
          p { margin-bottom: 20px; line-height: 1.6; }
          .retry-btn {
            background: #10b981;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
          }
          .retry-btn:hover { background: #059669; }
        </style>
      </head>
      <body>
        <div class="offline-container">
          <div class="offline-icon">📱</div>
          <h1>You're Offline</h1>
          <p>It looks like you're not connected to the internet. Some features may not be available.</p>
          <p>Please check your connection and try again.</p>
          <button class="retry-btn" onclick="window.location.reload()">Try Again</button>
        </div>
      </body>
      </html>
    `, {
      status: 503,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// Handle other requests
async function handleOtherRequests(request) {
  try {
    // External resources should never reach here (filtered in fetch event listener)
    // But add a safety check just in case
    const url = new URL(request.url);
    let currentOrigin;
    try {
      if (self.registration && self.registration.scope) {
        currentOrigin = new URL(self.registration.scope).origin;
      } else {
        currentOrigin = self.location.origin;
      }
    } catch (e) {
      currentOrigin = self.location.origin;
    }
    if (url.origin !== currentOrigin) {
      // This shouldn't happen, but if it does, let browser handle it
      return fetch(request, { redirect: 'follow' });
    }

    return await fetch(request, { redirect: 'follow' });
  } catch (error) {
    // Only return 503 for same-origin requests that fail
    // External resources should never reach this catch block
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // Return a response that won't cause errors
    return new Response('Content not available offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Background sync for form submissions
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  console.log('Service Worker: Performing background sync');
  // Handle any queued form submissions or data updates
  // This would typically sync with your backend API
}

// Push notification handling
self.addEventListener('push', event => {
  if (!event.data) {
    return;
  }

  // Tolerant payload parsing — push body may be malformed or non-JSON.
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    try {
      const text = event.data.text();
      data = { body: text };
    } catch (e2) {
      data = {};
    }
  }
  const options = {
    body: data.body,
    icon: '/images/icon-192x192.png',
    badge: '/images/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: data.primaryKey || 1
    },
    actions: [
      {
        action: 'explore',
        title: 'View Products',
        icon: '/images/icon-96x96.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/images/close-icon.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click handling
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      self.clients.openWindow('/categories')
    );
  } else if (event.action === 'close') {
    // Just close the notification
  } else {
    // Default action: open the app
    event.waitUntil(
      self.clients.openWindow('/')
    );
  }
});

// Message handling from main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Service Worker loaded successfully
