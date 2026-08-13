// Prefetch Handler
// Only add prefetch links if not on file:// protocol
// Prefetch links removed for file:// protocol compatibility

(function() {
    'use strict';
    
    // Only add prefetch links if not on file:// protocol
    if (window.location.protocol !== 'file:') {
        const prefetchLinks = [
            // Removed prefetch for optional endpoints to prevent 404 errors
            // These pages may not exist and prefetching causes console errors
        ];
        prefetchLinks.forEach(link => {
            const linkEl = document.createElement('link');
            linkEl.rel = link.rel;
            linkEl.href = link.href;
            document.head.appendChild(linkEl);
        });
    }
})();

