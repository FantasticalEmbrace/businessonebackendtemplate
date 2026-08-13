// Simple Service Worker Unregister - Copy ALL of this and paste into console
(async()=>{const r=await navigator.serviceWorker.getRegistrations();for(let reg of r)await reg.unregister();const c=await caches.keys();for(let n of c)await caches.delete(n);console.log('✅ Service worker and caches cleared! Refresh page (Ctrl+Shift+R)');})();

