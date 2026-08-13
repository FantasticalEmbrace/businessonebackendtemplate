'use strict';

/** Placeholder tracking ID assigned when payment completes; carrier URL can be set in admin later. */
function generateTrackingNumber() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    return `HMTRK${y}${m}${day}-${seq}`;
}

module.exports = { generateTrackingNumber };
