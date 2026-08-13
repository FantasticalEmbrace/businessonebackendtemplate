// Preload Handler
// Removes preload warnings for file:// protocol
// Run immediately to prevent preload warnings

(function() {
    'use strict';
    
    // Run immediately to prevent preload warnings
    if (window.location.protocol === 'file:') {
        // Function to remove preload links
        function removePreloadLinks() {
            const preloadLinks = document.querySelectorAll('link[rel="preload"]');
            preloadLinks.forEach(link => {
                const href = link.href || link.getAttribute('href') || '';
                if (href.includes('styles.css') || href.includes('script.js') || href.includes('fonts.googleapis.com')) {
                    link.remove();
                }
            });
        }

        // Remove immediately if head exists
        if (document.head) {
            removePreloadLinks();
        }

        // Also remove after a short delay to catch any dynamically added ones
        setTimeout(removePreloadLinks, 0);

        // Monitor for new preload links
        const observer = new MutationObserver(removePreloadLinks);
        if (document.head) {
            observer.observe(document.head, { childList: true, subtree: true });
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                observer.observe(document.head, { childList: true, subtree: true });
            });
        }
    }
})();

