'use strict';

(function () {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');
    const storeOrigin = String(params.get('store') || '').trim().replace(/\/+$/, '');
    const forcePlatform = params.get('mode') === 'platform';
    const merchantLabel = params.get('merchant') || '';
    const statusEl = document.getElementById('status');
    const videoEl = document.getElementById('remote-video');
    const merchantEl = document.getElementById('viewer-merchant');

    if (merchantEl && merchantLabel) {
        merchantEl.textContent = merchantLabel;
    }

    let pc = null;
    let signalVersion = 0;
    let pollTimer = null;
    let authToken = null;
    let platformKey = null;

    const initialHash = (() => {
        const raw = String(window.location.hash || '').replace(/^#/, '');
        if (!raw) return { token: '', platformKey: '' };
        const hashParams = new URLSearchParams(raw);
        const token = hashParams.get('token') || '';
        const key = hashParams.get('platformKey') || hashParams.get('key') || '';
        if (token || key) {
            const clean = `${window.location.pathname}${window.location.search}`;
            history.replaceState(null, '', clean);
        }
        return { token, platformKey: key };
    })();
    authToken = initialHash.token;
    platformKey = initialHash.platformKey;
    const isPlatformMode = Boolean(storeOrigin) || forcePlatform || Boolean(platformKey);

    function apiBase() {
        return storeOrigin || window.location.origin;
    }

    function apiPrefix() {
        return isPlatformMode ? '/api/platform/support/store' : '/api/admin/pos';
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function getToken() {
        if (isPlatformMode) return '';
        if (authToken) return authToken;
        authToken =
            localStorage.getItem('adminToken') ||
            localStorage.getItem('authToken') ||
            sessionStorage.getItem('adminToken') ||
            '';
        if (!authToken) {
            authToken = window.prompt('Paste your admin API token (from admin while logged in):') || '';
        }
        return authToken;
    }

    function getPlatformKey() {
        if (!isPlatformMode) return '';
        if (platformKey) return platformKey;
        platformKey = window.prompt('Platform support key (from support queue):') || '';
        return platformKey;
    }

    async function api(path, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        if (isPlatformMode) {
            headers['X-Platform-Hub-Secret'] = getPlatformKey();
        } else {
            headers.Authorization = `Bearer ${getToken()}`;
        }
        const res = await fetch(`${apiBase()}${apiPrefix()}${path}`, {
            ...options,
            headers
        });
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = { raw: text };
        }
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
        return data;
    }

    function cleanup() {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
        if (pc) pc.close();
        pc = null;
        if (videoEl) videoEl.srcObject = null;
    }

    function sessionPath(suffix) {
        if (isPlatformMode) return `/sessions/${sessionId}${suffix}`;
        return `/support/sessions/${sessionId}${suffix}`;
    }

    async function pollSignal() {
        if (!pc || !sessionId) return;
        try {
            const state = await api(sessionPath(`/signal?since=${signalVersion}`));
            if (state.changed) {
                signalVersion = state.signalVersion || signalVersion;
                if (state.offerSdp && !pc.currentRemoteDescription) {
                    await pc.setRemoteDescription({ type: 'offer', sdp: state.offerSdp });
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    await api(sessionPath('/answer'), {
                        method: 'POST',
                        body: JSON.stringify({ sdp: answer.sdp })
                    });
                    setStatus('Connected — viewing register screen');
                }
                for (const c of state.posIce || []) {
                    try {
                        await pc.addIceCandidate(c);
                    } catch {
                        /* ignore */
                    }
                }
                if (state.session?.status === 'ended') {
                    setStatus('Session ended');
                    cleanup();
                    return;
                }
            }
        } catch (e) {
            setStatus(e.message || 'Connection error');
        }
        pollTimer = setTimeout(pollSignal, 1500);
    }

    async function start() {
        if (!sessionId) {
            setStatus('Missing session id in URL');
            return;
        }
        // storeOrigin is optional when the viewer is hosted on the merchant store (apiBase uses location.origin).
        cleanup();
        setStatus('Waiting for register screen share…');

        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pc.ontrack = (ev) => {
            if (videoEl && ev.streams[0]) {
                videoEl.srcObject = ev.streams[0];
                const playPromise = videoEl.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => setStatus('Video ready — click Retry if the screen stays black'));
                }
            }
        };
        pc.onicecandidate = (ev) => {
            if (!ev.candidate) return;
            api(sessionPath('/ice'), {
                method: 'POST',
                body: JSON.stringify({ candidate: ev.candidate.toJSON() })
            }).catch(() => {});
        };

        await api(sessionPath('/join'), { method: 'POST' }).catch(() => {});
        signalVersion = 0;
        pollSignal();
    }

    async function endSession() {
        if (sessionId) {
            try {
                await api(sessionPath('/end'), { method: 'POST' });
            } catch {
                /* ignore */
            }
        }
        cleanup();
        setStatus('Session ended');
    }

    document.getElementById('end-btn')?.addEventListener('click', endSession);
    document.getElementById('reload-btn')?.addEventListener('click', start);
    start();
})();
