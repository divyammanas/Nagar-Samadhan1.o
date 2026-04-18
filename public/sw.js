const CACHE_NAME = 'nagar-samadhan-v1.0';
const STATIC_CACHE_URLS = [
  '/',
  '/index.html',
  '/citizen.html',
  '/admin.html',
  '/admin-login.html',
  '/report.html',
  '/manifest.json',
  '/notifications-simple.js',
  'https://cdn.tailwindcss.com/3.3.0.css',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching static assets');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .catch(error => {
        console.error('Service Worker: Failed to cache static assets:', error);
      })
  );
  
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('Service Worker: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Take control of all pages immediately
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Handle API requests differently
  if (url.pathname.startsWith('/api/')) {
    // For API requests, try network first, then fallback to cache for GET requests
    if (request.method === 'GET') {
      event.respondWith(
        fetch(request)
          .then(response => {
            // Cache successful API responses
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(request, responseClone);
                });
            }
            return response;
          })
          .catch(() => {
            // Return cached version if network fails
            return caches.match(request)
              .then(response => {
                if (response) {
                  console.log('Service Worker: Serving API request from cache:', request.url);
                  return response;
                }
                // Return offline fallback for API requests
                return new Response(JSON.stringify({
                  error: 'Offline',
                  message: 'This feature requires an internet connection'
                }), {
                  status: 503,
                  statusText: 'Service Unavailable',
                  headers: {
                    'Content-Type': 'application/json'
                  }
                });
              });
          })
      );
    } else {
      // For POST/PUT/DELETE, always try network
      event.respondWith(
        fetch(request)
          .catch(() => {
            return new Response(JSON.stringify({
              error: 'Offline',
              message: 'Cannot perform this action while offline'
            }), {
              status: 503,
              statusText: 'Service Unavailable',
              headers: {
                'Content-Type': 'application/json'
              }
            });
          })
      );
    }
    return;
  }
  
  // Handle media files
  if (url.pathname.startsWith('/api/media/')) {
    event.respondWith(
      caches.match(request)
        .then(response => {
          if (response) {
            console.log('Service Worker: Serving media from cache:', request.url);
            return response;
          }
          
          return fetch(request)
            .then(response => {
              if (response.ok) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME)
                  .then(cache => {
                    cache.put(request, responseClone);
                  });
              }
              return response;
            });
        })
    );
    return;
  }
  
  // For static assets and HTML pages, use cache-first strategy
  event.respondWith(
    caches.match(request)
      .then(response => {
        if (response) {
          console.log('Service Worker: Serving from cache:', request.url);
          return response;
        }
        
        // Not in cache, fetch from network
        return fetch(request)
          .then(response => {
            // Don't cache non-successful responses
            if (!response.ok) {
              return response;
            }
            
            // Clone the response
            const responseClone = response.clone();
            
            // Add to cache
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(request, responseClone);
              });
            
            return response;
          })
          .catch(() => {
            // Network failed, show offline page for navigation requests
            if (request.destination === 'document') {
              return caches.match('/index.html');
            }
          });
      })
  );
});

// Handle background sync for offline form submissions
self.addEventListener('sync', event => {
  console.log('Service Worker: Background sync triggered:', event.tag);
  
  if (event.tag === 'background-sync-report') {
    event.waitUntil(syncReports());
  }
});

// Sync pending reports when back online
async function syncReports() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const pendingRequests = await cache.match('/offline-reports');
    
    if (pendingRequests) {
      const reports = await pendingRequests.json();
      
      for (const report of reports) {
        try {
          const response = await fetch('https://nagar-samadhan1-o.onrender.com/api/reports', {
            method: 'POST',
            body: report.formData
          });
          
          if (response.ok) {
            console.log('Service Worker: Successfully synced offline report');
            // Remove from pending list
            // This would require more complex indexedDB implementation
          }
        } catch (error) {
          console.error('Service Worker: Failed to sync report:', error);
        }
      }
    }
  } catch (error) {
    console.error('Service Worker: Background sync failed:', error);
  }
}

// Handle push notifications (future enhancement)
self.addEventListener('push', event => {
  console.log('Service Worker: Push notification received');
  
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body || 'You have a new update from Nagar Samadhan',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      tag: data.tag || 'nagar-samadhan-notification',
      vibrate: [200, 100, 200],
      actions: [
        {
          action: 'open',
          title: 'View Details',
          icon: '/icons/action-open.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
          icon: '/icons/action-dismiss.png'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(
        data.title || 'Nagar Samadhan',
        options
      )
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  console.log('Service Worker: Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Handle messages from the main thread
self.addEventListener('message', event => {
  console.log('Service Worker: Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Clean up caches periodically
setInterval(() => {
  console.log('Service Worker: Performing periodic cache cleanup');
  
  caches.keys().then(cacheNames => {
    cacheNames.forEach(cacheName => {
      if (cacheName !== CACHE_NAME) {
        caches.delete(cacheName);
      }
    });
  });
}, 24 * 60 * 60 * 1000); // Once per day