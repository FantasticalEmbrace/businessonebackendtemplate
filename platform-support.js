'use strict';

(function () {
    const HUB_STORAGE_KEY = 'businessOneSupportHubUrl';
    const TOKEN_STORAGE_KEY = 'businessOneSupportTechToken';
    const TECH_STORAGE_KEY = 'businessOneSupportTechProfile';

    const waitingList = document.getElementById('waiting-list');
    const progressList = document.getElementById('progress-list');
    const queueApp = document.getElementById('queue-app');
    const loginScreen = document.getElementById('login-screen');
    const statusMsg = document.getElementById('status-msg');
    const loginError = document.getElementById('login-error');
    const hubUrlInput = document.getElementById('hub-url');

    let authToken = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
    let technicianProfile = null;
    try {
        technicianProfile = JSON.parse(localStorage.getItem(TECH_STORAGE_KEY) || 'null');
    } catch {
        technicianProfile = null;
    }
    let platformViewerKey = '';
    let pollTimer = null;
    let lastWaitingCount = 0;
    let hubInfo = {
        technicianLoginConfigured: true,
        googleLoginConfigured: false,
        hubTitle: 'Business One Support Desk',
        hubPublicUrl: '',
        merchantStoreUrl: ''
    };

    function decodeBase64UrlJson(b64) {
        if (!b64) return null;
        try {
            const padded = String(b64).replace(/-/g, '+').replace(/_/g, '/');
            const pad = padded.length % 4 === 0 ? padded : padded + '='.repeat(4 - (padded.length % 4));
            return JSON.parse(atob(pad));
        } catch {
            return null;
        }
    }

    function consumeOAuthReturn() {
        const url = new URL(window.location.href);
        const qsError = url.searchParams.get('error');
        if (qsError) {
            url.searchParams.delete('error');
            history.replaceState(null, '', `${url.pathname}${url.search}`);
            return { error: qsError };
        }
        const hashRaw = url.hash.replace(/^#/, '');
        if (!hashRaw) return null;
        const params = new URLSearchParams(hashRaw);
        const token = params.get('token');
        if (!token) return null;
        const technician = decodeBase64UrlJson(params.get('technician'));
        history.replaceState(null, '', `${url.pathname}${url.search}`);
        return { token, technician };
    }

    function updateGoogleLoginVisibility() {
        const show = hubInfo.googleLoginConfigured === true;
        document.getElementById('google-login-wrap')?.classList.toggle('hidden', !show);
        document.getElementById('google-login-btn')?.classList.toggle('hidden', !show);
    }

    function looksLikeMerchantHubUrl(url) {
        const u = String(url || '').trim().toLowerCase();
        if (!u) return false;
        const merchant = String(hubInfo.merchantStoreUrl || '').trim().toLowerCase();
        if (merchant && u.replace(/\/+$/, '') === merchant.replace(/\/+$/, '')) return true;
        return /\bhmherbs\b/.test(u) && !/\/support\b/.test(u);
    }

    function updateHubUrlWarning() {
        const warn = document.getElementById('hub-url-warning');
        if (!warn || !hubUrlInput) return;
        const val = hubUrlInput.value.trim();
        if (looksLikeMerchantHubUrl(val)) {
            warn.textContent =
                'That looks like a merchant store URL, not the Business One support hub. Use your support server (e.g. support.yourbusinessone.com).';
            warn.classList.remove('hidden');
        } else {
            warn.textContent = '';
            warn.classList.add('hidden');
        }
    }

    function parseHubServerOrigin(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        try {
            const withProto = /^https?:\/\//i.test(s) ? s : `http://${s}`;
            return new URL(withProto).origin;
        } catch {
            return s
                .replace(/\/+$/, '')
                .replace(/\/support-desk.*$/i, '')
                .replace(/\/platform-support\.html.*$/i, '');
        }
    }

    function hubOrigin() {
        const fromInput = hubUrlInput?.value?.trim();
        if (fromInput) return parseHubServerOrigin(fromInput);
        const stored = localStorage.getItem(HUB_STORAGE_KEY);
        if (stored) return parseHubServerOrigin(stored);
        return parseHubServerOrigin(window.location.origin);
    }

    function persistHubUrl() {
        const url = hubOrigin();
        if (url) localStorage.setItem(HUB_STORAGE_KEY, url);
    }

    function setStatus(text) {
        if (statusMsg) statusMsg.textContent = text || '';
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function statusBadge(status) {
        const s = String(status || '').toLowerCase();
        const cls =
            s === 'pending'
                ? 'status-pill pending'
                : s === 'awaiting_consent'
                  ? 'status-pill awaiting'
                  : s === 'connecting'
                    ? 'status-pill connecting'
                    : s === 'active'
                      ? 'status-pill active'
                      : 'status-pill offline';
        const label = s === 'awaiting_consent' ? 'Awaiting consent' : s.replace(/_/g, ' ');
        return `<span class="${cls}">${escapeHtml(label)}</span>`;
    }

    function formatWhen(value) {
        if (!value) return '—';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleString();
    }

    async function api(path, options = {}) {
        const res = await fetch(`${hubOrigin()}/api/platform/support/hub${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
                ...(options.headers || {})
            }
        });
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = { raw: text };
        }
        if (res.status === 401 || res.status === 403) {
            authToken = '';
            localStorage.removeItem(TOKEN_STORAGE_KEY);
            showLogin('Session expired — sign in again.');
            throw new Error(data?.error || 'Unauthorized');
        }
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
        return data;
    }

    async function fetchHubInfo() {
        const origin = hubOrigin();
        if (!origin) return;
        try {
            const res = await fetch(`${origin}/api/platform/support/hub/info`);
            if (res.ok) {
                hubInfo = await res.json();
                const titleEl = document.getElementById('desk-title');
                if (titleEl && hubInfo.hubTitle) titleEl.textContent = hubInfo.hubTitle;
                if (hubUrlInput && hubInfo.hubPublicUrl) {
                    hubUrlInput.value = hubInfo.hubPublicUrl;
                    persistHubUrl();
                }
                updateHubUrlWarning();
                updateGoogleLoginVisibility();
            }
        } catch {
            /* hub may be offline */
        }
    }

    function showLogin(message) {
        if (queueApp) queueApp.classList.add('hidden');
        if (loginScreen) loginScreen.classList.remove('hidden');
        if (loginError) {
            loginError.textContent = message || '';
        }
        updateGoogleLoginVisibility();
        const techLine = document.getElementById('login-tech-hint');
        if (techLine) {
            techLine.textContent = hubInfo.technicianLoginConfigured
                ? 'Sign in with your Business One support desk account (not a merchant store admin).'
                : 'Technician login is not configured on this hub yet — ask your administrator to set PLATFORM_SUPPORT_TECH_EMAIL.';
        }
    }

    function showQueue() {
        if (loginScreen) loginScreen.classList.add('hidden');
        if (queueApp) queueApp.classList.remove('hidden');
        const signedIn = document.getElementById('signed-in-as');
        if (signedIn && technicianProfile?.name) {
            signedIn.textContent = `Signed in as ${technicianProfile.name}`;
        }
    }

    function notifyNewWaiting(count) {
        if (count <= lastWaitingCount) return;
        const delta = count - lastWaitingCount;
        const body =
            delta === 1
                ? 'A register is waiting for remote assistance.'
                : `${delta} registers are waiting for remote assistance.`;
        if (window.Notification && Notification.permission === 'granted') {
            new Notification('Business One Support', { body });
        }
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.value = 0.04;
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
        } catch {
            /* optional beep */
        }
    }

    function renderRows(container, items, { allowConnect }) {
        if (!container) return;
        if (!items.length) {
            container.innerHTML = '<div class="empty">None right now.</div>';
            return;
        }
        container.innerHTML = items
            .map((item) => {
                const online = item.registerOnline
                    ? '<span class="status-pill online">Online</span>'
                    : '<span class="status-pill offline">Offline</span>';
                const connectBtn =
                    allowConnect && item.registerOnline && platformViewerKey
                        ? `<button type="button" class="btn btn-primary" data-connect="${item.storeSessionId}" data-store="${escapeHtml(item.storeBaseUrl)}" data-merchant-id="${escapeHtml(item.merchantId)}" data-merchant="${escapeHtml(item.merchantName)}">Connect screen</button>`
                        : '';
                return `<div class="queue-row">
                    <div>
                        <div class="queue-row-title">${escapeHtml(item.merchantName)} · ${escapeHtml(item.deviceLabel)}</div>
                        <div class="queue-row-meta">
                            ${statusBadge(item.status)} ${online}
                            <span>· ${escapeHtml(item.platform || 'unknown')}</span>
                            <span>· Code ${escapeHtml(item.sessionCode)}</span>
                        </div>
                        <div class="queue-row-meta">Requested ${escapeHtml(formatWhen(item.sessionCreatedAt))}${item.claimedBy ? ` · Claimed by ${escapeHtml(item.claimedBy)}` : ''}</div>
                    </div>
                    <div>${connectBtn}</div>
                </div>`;
            })
            .join('');

        container.querySelectorAll('[data-connect]').forEach((btn) => {
            btn.addEventListener('click', () => connectSession(btn));
        });
    }

    async function connectSession(btn) {
        const sessionId = btn.getAttribute('data-connect');
        const storeBase = btn.getAttribute('data-store');
        const merchantId = btn.getAttribute('data-merchant-id') || '';
        const merchant = btn.getAttribute('data-merchant') || 'Merchant';
        if (!sessionId || !platformViewerKey) {
            alert('Missing session or platform key.');
            return;
        }

        btn.disabled = true;
        try {
            const data = await api('/connect', {
                method: 'POST',
                body: JSON.stringify({
                    storeSessionId: Number(sessionId),
                    merchantId
                })
            });

            const viewer = new URL(data.viewerUrl || `${storeBase}/support-viewer.html`);
            if (!data.viewerUrl) {
                viewer.searchParams.set('session', sessionId);
                viewer.searchParams.set('mode', 'platform');
            }
            if (!viewer.searchParams.get('store') && storeBase) {
                viewer.searchParams.set('store', storeBase);
            }
            if (merchant) {
                viewer.searchParams.set('merchant', merchant);
            }
            viewer.hash = `platformKey=${encodeURIComponent(platformViewerKey)}`;
            window.open(viewer.toString(), '_blank', 'noopener,noreferrer,width=1100,height=720');
            setStatus(`Connecting to ${merchant} — cashier must allow screen share on the register.`);
            await loadQueue();
        } catch (e) {
            alert(e.message || 'Connect failed');
        } finally {
            btn.disabled = false;
        }
    }

    async function loadQueue() {
        const data = await api('/queue');
        platformViewerKey = data.platformViewerKey || platformViewerKey;
        const waiting = data.waiting || [];
        document.getElementById('stat-waiting').textContent = String(data.counts?.waiting || 0);
        document.getElementById('stat-progress').textContent = String(data.counts?.inProgress || 0);
        document.getElementById('stat-total').textContent = String(data.counts?.total || 0);
        renderRows(waitingList, waiting, { allowConnect: true });
        renderRows(progressList, data.inProgress || [], { allowConnect: true });
        notifyNewWaiting(waiting.length);
        lastWaitingCount = waiting.length;
        setStatus(`Updated ${new Date().toLocaleTimeString()}`);
        showQueue();
    }

    async function completeSignIn(token, technician) {
        authToken = token;
        technicianProfile = technician || null;
        localStorage.setItem(TOKEN_STORAGE_KEY, authToken);
        if (technicianProfile) {
            localStorage.setItem(TECH_STORAGE_KEY, JSON.stringify(technicianProfile));
        }
        showQueue();
        await loadQueue();
        startPolling();
    }

    async function login() {
        const email = document.getElementById('login-email')?.value?.trim();
        const password = document.getElementById('login-password')?.value || '';
        if (!email || !password) {
            if (loginError) loginError.textContent = 'Email and password required.';
            return;
        }
        if (looksLikeMerchantHubUrl(hubUrlInput?.value)) {
            if (loginError) {
                loginError.textContent =
                    'Use your Business One support hub URL — not a merchant store website like HM Herbs.';
            }
            return;
        }
        persistHubUrl();
        if (loginError) loginError.textContent = '';
        try {
            await fetchHubInfo();
            const res = await fetch(`${hubOrigin()}/api/platform/support/hub/technician/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Login failed');
            await completeSignIn(data.token, data.technician || { email, name: email });
        } catch (e) {
            if (loginError) loginError.textContent = e.message || 'Login failed';
        }
    }

    function loginWithGoogle() {
        if (looksLikeMerchantHubUrl(hubUrlInput?.value)) {
            if (loginError) {
                loginError.textContent =
                    'Use your Business One support hub URL — not a merchant store website like HM Herbs.';
            }
            return;
        }
        persistHubUrl();
        if (loginError) loginError.textContent = '';
        const returnTo = '/support-desk';
        window.location.href = `${hubOrigin()}/api/platform/support/hub/google/start?returnTo=${encodeURIComponent(returnTo)}`;
    }

    function logout() {
        authToken = '';
        technicianProfile = null;
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(TECH_STORAGE_KEY);
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        showLogin();
    }

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        const tick = () => {
            if (!authToken) return;
            loadQueue().catch(() => {});
        };
        pollTimer = setInterval(tick, 5000);
    }

    document.getElementById('reload-btn')?.addEventListener('click', () => loadQueue().catch((e) => setStatus(e.message)));
    document.getElementById('login-btn')?.addEventListener('click', login);
    document.getElementById('google-login-btn')?.addEventListener('click', loginWithGoogle);
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    document.getElementById('notify-btn')?.addEventListener('click', async () => {
        if (!window.Notification) {
            alert('Desktop notifications are not supported in this browser.');
            return;
        }
        const perm = await Notification.requestPermission();
        if (perm === 'granted') setStatus('Notifications enabled for new help requests.');
        else setStatus('Notifications blocked — enable them in Windows/browser settings.');
    });

    if (hubUrlInput) {
        hubUrlInput.addEventListener('change', async () => {
            updateHubUrlWarning();
            persistHubUrl();
            if (window.businessOneDesk?.setHubUrl) {
                try {
                    await window.businessOneDesk.setHubUrl(hubUrlInput.value);
                } catch {
                    /* optional */
                }
            }
        });
    }

    (async function init() {
        if (window.businessOneDesk?.getHubUrl) {
            try {
                const deskHub = await window.businessOneDesk.getHubUrl();
                if (deskHub && hubUrlInput) {
                    hubUrlInput.value = deskHub;
                    persistHubUrl();
                }
            } catch {
                /* optional */
            }
        } else if (hubUrlInput) {
            const stored = localStorage.getItem(HUB_STORAGE_KEY) || '';
            hubUrlInput.value = stored;
            if (looksLikeMerchantHubUrl(stored)) {
                hubUrlInput.value = '';
                localStorage.removeItem(HUB_STORAGE_KEY);
            }
        }
        await fetchHubInfo();
        const localLink = document.getElementById('support-desk-local-link');
        if (localLink && hubOrigin()) {
            localLink.href = `${hubOrigin()}/support-desk`;
        }
        if (hubUrlInput && !hubUrlInput.value.trim()) {
            hubUrlInput.value = hubOrigin() || 'http://127.0.0.1:3001';
        }
        updateHubUrlWarning();
        updateGoogleLoginVisibility();

        const oauth = consumeOAuthReturn();
        if (oauth?.error) {
            showLogin(oauth.error);
            return;
        }
        if (oauth?.token) {
            try {
                await completeSignIn(oauth.token, oauth.technician);
                return;
            } catch (e) {
                showLogin(e.message || 'Google sign-in failed');
                return;
            }
        }

        if (authToken) {
            try {
                await loadQueue();
                startPolling();
            } catch {
                showLogin();
            }
        } else {
            showLogin();
        }
    })();
})();
