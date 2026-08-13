// EDSA image — class-based visibility (no inline styles)

(function () {
    'use strict';

    function ensureEDSALoads() {
        const edsaImg = document.querySelector('.edsa-image img') || document.getElementById('edsa-main-image');
        if (!edsaImg) return;

        edsaImg.classList.add('loaded');

        edsaImg.addEventListener(
            'load',
            function () {
                this.classList.add('loaded');
            },
            { once: true }
        );

        edsaImg.addEventListener(
            'error',
            function () {
                const altPaths = ['./images/edsa.jpg', 'images/edsa.jpg', '/images/edsa.jpg'];
                let pathIndex = 0;

                const tryNextPath = () => {
                    if (pathIndex >= altPaths.length) return;
                    const testImg = new Image();
                    testImg.addEventListener(
                        'load',
                        () => {
                            edsaImg.src = altPaths[pathIndex];
                            edsaImg.classList.add('loaded');
                        },
                        { once: true }
                    );
                    testImg.addEventListener(
                        'error',
                        () => {
                            pathIndex++;
                            tryNextPath();
                        },
                        { once: true }
                    );
                    testImg.src = altPaths[pathIndex];
                };
                tryNextPath();
            },
            { once: true }
        );

        if (!edsaImg.complete || edsaImg.naturalWidth === 0) {
            const originalSrc = edsaImg.src || edsaImg.getAttribute('src') || 'images/edsa.jpg';
            const img = new Image();
            img.addEventListener(
                'load',
                function () {
                    edsaImg.src = originalSrc;
                    edsaImg.classList.add('loaded');
                },
                { once: true }
            );
            img.src = originalSrc;
        }
    }

    function attachEDSABookingListener() {
        const edsaBookBtn = document.getElementById('edsa-book-btn');
        if (edsaBookBtn && typeof window.openEDSABooking === 'function') {
            edsaBookBtn.addEventListener('click', (e) => window.openEDSABooking(e));
        } else if (edsaBookBtn) {
            setTimeout(attachEDSABookingListener, 100);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureEDSALoads();
            attachEDSABookingListener();
        });
    } else {
        ensureEDSALoads();
        attachEDSABookingListener();
    }
})();
