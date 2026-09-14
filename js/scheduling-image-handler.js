// Scheduling image — class-based visibility (no inline styles)

(function () {
    'use strict';

    function ensureSchedulingLoads() {
        const schedulingImg = document.querySelector('.scheduling-image img') || document.getElementById('scheduling-main-image');
        if (!schedulingImg) return;

        schedulingImg.classList.add('loaded');

        schedulingImg.addEventListener(
            'load',
            function () {
                this.classList.add('loaded');
            },
            { once: true }
        );

        schedulingImg.addEventListener(
            'error',
            function () {
                const altPaths = ['./images/scheduling.jpg', 'images/scheduling.jpg', '/images/scheduling.jpg'];
                let pathIndex = 0;

                const tryNextPath = () => {
                    if (pathIndex >= altPaths.length) return;
                    const testImg = new Image();
                    testImg.addEventListener(
                        'load',
                        () => {
                            schedulingImg.src = altPaths[pathIndex];
                            schedulingImg.classList.add('loaded');
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

        if (!schedulingImg.complete || schedulingImg.naturalWidth === 0) {
            const originalSrc = schedulingImg.src || schedulingImg.getAttribute('src') || 'images/scheduling.jpg';
            const img = new Image();
            img.addEventListener(
                'load',
                function () {
                    schedulingImg.src = originalSrc;
                    schedulingImg.classList.add('loaded');
                },
                { once: true }
            );
            img.src = originalSrc;
        }
    }

    function attachSchedulingBookingListener() {
        const schedulingBookBtn = document.getElementById('scheduling-book-btn');
        if (schedulingBookBtn && typeof window.openSchedulingBooking === 'function') {
            schedulingBookBtn.addEventListener('click', (e) => window.openSchedulingBooking(e));
        } else if (schedulingBookBtn) {
            setTimeout(attachSchedulingBookingListener, 100);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureSchedulingLoads();
            attachSchedulingBookingListener();
        });
    } else {
        ensureSchedulingLoads();
        attachSchedulingBookingListener();
    }
})();
