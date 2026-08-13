// Native Fetch Storage
// CRITICAL: This must load BEFORE any scripts that wrap window.fetch
// Stores the native fetch function so all wrappers can access the true native fetch
// This prevents fetch wrapper chaining issues where wrappers store other wrappers instead of native fetch

(function() {
    'use strict';
    
    // Store the native fetch function before any scripts wrap it
    // This ensures all fetch wrappers can access the true native fetch
    if (!window.__nativeFetch) {
        window.__nativeFetch = window.fetch.bind(window);
    }
})();

