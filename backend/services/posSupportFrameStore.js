'use strict';

/**
 * In-memory JPEG previews for register support (Android app path).
 * Avoids Android WebView WebRTC canvas.captureStream failures.
 */
const frames = new Map(); // sessionId -> { mime, dataBase64, width, height, updatedAt }

const MAX_BYTES = 900000; // WebP/JPEG @ 960px q72 with headroom

// Frames are only removed explicitly via clearFrame() (called from endSession()).
// If a support session is abandoned (app crash, network drop, tab closed) without an
// explicit end, its ~up-to-900KB frame would otherwise sit in memory forever. Sweep
// stale entries periodically so an abandoned session can't leak memory indefinitely.
const STALE_FRAME_MS = 15 * 60 * 1000; // 15 minutes of no new frame = abandoned
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function sweepStaleFrames() {
    const now = Date.now();
    for (const [id, frame] of frames.entries()) {
        if (now - (frame.updatedAt || 0) > STALE_FRAME_MS) {
            frames.delete(id);
        }
    }
}

const sweepTimer = setInterval(sweepStaleFrames, SWEEP_INTERVAL_MS);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

function setFrame(sessionId, payload = {}) {
    const id = String(sessionId || '').trim();
    if (!id) return false;
    const dataBase64 = String(payload.data || payload.dataBase64 || '').replace(/\s+/g, '');
    if (!dataBase64 || dataBase64.length > MAX_BYTES) return false;
    const mime = String(payload.mime || 'image/jpeg').slice(0, 64);
    frames.set(id, {
        mime,
        dataBase64,
        width: Number(payload.width) || 0,
        height: Number(payload.height) || 0,
        updatedAt: Date.now()
    });
    return true;
}

function getFrame(sessionId, since = 0) {
    const id = String(sessionId || '').trim();
    if (!id) return null;
    const frame = frames.get(id);
    if (!frame) return null;
    const sinceN = Number(since) || 0;
    if (sinceN > 0 && frame.updatedAt <= sinceN) {
        return { unchanged: true, updatedAt: frame.updatedAt };
    }
    return frame;
}

function clearFrame(sessionId) {
    frames.delete(String(sessionId || '').trim());
}

function hasFrame(sessionId) {
    return frames.has(String(sessionId || '').trim());
}

module.exports = {
    setFrame,
    getFrame,
    clearFrame,
    hasFrame
};
