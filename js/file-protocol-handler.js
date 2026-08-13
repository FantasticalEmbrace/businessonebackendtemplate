// File Protocol Handler
// Handles file:// protocol issues by removing problematic links
// Must run immediately to prevent preload warnings and CORS errors

(function() {
    'use strict';
    
    // Run immediately to prevent preload warnings and CORS errors
    if (window.location.protocol === 'file:') {
        // Function to remove preload links and manifest link
        function removeProblematicLinks() {
            if (document.head) {
                // Remove preload links (including Google Fonts)
                const preloadLinks = document.querySelectorAll('link[rel="preload"]');
                preloadLinks.forEach(link => {
                    const href = link.href || link.getAttribute('href') || '';
                    if (href.includes('styles.css') || href.includes('script.js') || href.includes('fonts.googleapis.com')) {
                        link.remove();
                    }
                });

                // Remove manifest link to prevent CORS error
                const manifestLinks = document.querySelectorAll('link[rel="manifest"]');
                manifestLinks.forEach(link => {
                    link.remove();
                });

                // Remove prefetch links to prevent file:// errors
                const prefetchLinks = document.querySelectorAll('link[rel="prefetch"]');
                prefetchLinks.forEach(link => {
                    link.remove();
                });
            }
        }

        // Remove immediately
        removeProblematicLinks();

        // Also monitor for new ones
        if (document.head) {
            const observer = new MutationObserver(removeProblematicLinks);
            observer.observe(document.head, { childList: true, subtree: true });
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                removeProblematicLinks();
                const observer = new MutationObserver(removeProblematicLinks);
                observer.observe(document.head, { childList: true, subtree: true });
            });
        }

    }
})();

