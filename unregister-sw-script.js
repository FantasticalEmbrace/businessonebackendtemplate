// Service Worker Unregistration Script
// Copy and paste this entire block into the browser console

(async function () {
    console.log('🔍 Checking for service workers...');

    if ('serviceWorker' in navigator) {
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();

            if (registrations.length === 0) {
                console.log('✅ No service workers registered.');
                return;
            }

            console.log(`📋 Found ${registrations.length} service worker(s)`);

            for (let registration of registrations) {
                const unregistered = await registration.unregister();
                if (unregistered) {
                    console.log('✅ Service worker unregistered successfully!');
                } else {
                    console.log('⚠️ Service worker unregistration returned false.');
                }
            }

            // Clear all caches
            if ('caches' in window) {
                console.log('🗑️ Clearing caches...');
                const cacheNames = await caches.keys();
                console.log(`📋 Found ${cacheNames.length} cache(s)`);

                for (let cacheName of cacheNames) {
                    await caches.delete(cacheName);
                    console.log(`✅ Cache deleted: ${cacheName}`);
                }

                if (cacheNames.length === 0) {
                    console.log('✅ No caches to delete.');
                }
            }

            console.log('🎉 All done! Refresh the page to register the new service worker.');
            console.log('💡 Press Ctrl+Shift+R (or Cmd+Shift+R on Mac) for a hard refresh.');

        } catch (error) {
            console.error('❌ Error:', error);
        }
    } else {
        console.log('⚠️ Service workers are not supported in this browser.');
    }
})();

