/**
 * Wishlists: fetch collections and add items. Product detail uses a small picker
 * so customers can choose which list to add to.
 */
(function () {
    'use strict';

    function hmHerbsWishlistBackendOrigin() {
        if (typeof window === 'undefined') return '';
        if (window.location.protocol === 'file:') return 'http://localhost:3001';
        const h = window.location.hostname;
        const loop = h === 'localhost' || h === '127.0.0.1';
        if (loop && window.location.port !== '3001') return 'http://localhost:3001';
        return '';
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function notify(msg, type) {
        const t = type || 'info';
        if (window.productDetailPage && typeof window.productDetailPage.showNotification === 'function') {
            window.productDetailPage.showNotification(msg, t);
            return;
        }
        if (window.customerAuth && typeof window.customerAuth.showNotification === 'function') {
            window.customerAuth.showNotification(msg, t);
            return;
        }
        if (typeof window.hmShowToast === 'function') {
            window.hmShowToast(msg, t);
        } else if (window.hmHerbsApp && typeof window.hmHerbsApp.showNotification === 'function') {
            window.hmHerbsApp.showNotification(msg, t);
            return;
        }
        if (t === 'error') console.error(msg);
        else console.info(msg);
    }

    function readStoredToken() {
        try {
            if (window.customerAuth && typeof window.customerAuth.getToken === 'function') {
                const t = window.customerAuth.getToken();
                if (t && String(t).trim()) return String(t).trim();
            }
            const ls = localStorage.getItem('hmherbs_customer_token');
            return ls && String(ls).trim() ? String(ls).trim() : null;
        } catch {
            return null;
        }
    }

    async function waitForCustomerAuth(maxMs = 2500) {
        const start = Date.now();
        while (Date.now() - start < maxMs) {
            if (window.customerAuth) {
                try {
                    if (typeof window.customerAuth.checkAuthStatus === 'function') {
                        window.customerAuth.checkAuthStatus();
                    }
                } catch {
                    /* ignore */
                }
                return window.customerAuth;
            }
            await new Promise((r) => setTimeout(r, 25));
        }
        return window.customerAuth || null;
    }

    /** @returns {Promise<{ apiRoot: string, headers: Record<string,string> } | null>} */
    async function getWishlistAuthContext() {
        await waitForCustomerAuth();
        const token = readStoredToken();
        if (!token) {
            notify('Sign in to save items to your lists.', 'info');
            if (window.customerAuth && typeof window.customerAuth.openLoginModal === 'function') {
                window.customerAuth.openLoginModal();
            }
            return null;
        }
        const origin = hmHerbsWishlistBackendOrigin();
        const apiRoot = origin ? `${origin}/api` : '/api';
        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        };
        return { apiRoot, headers };
    }

    function removeExistingPicker() {
        document.getElementById('hm-wishlist-picker-backdrop')?.remove();
        document.getElementById('hm-wishlist-picker-dim')?.remove();
        document.getElementById('hm-wishlist-picker-panel')?.remove();
    }

    function openWishlistPickerModal(panelHtml) {
        removeExistingPicker();
        const backdrop = document.createElement('div');
        backdrop.className = 'acct-modal-backdrop is-open hm-wl-picker-backdrop';
        backdrop.id = 'hm-wishlist-picker-backdrop';
        backdrop.setAttribute('role', 'presentation');

        const panel = document.createElement('div');
        panel.className = 'acct-modal wishlist-modal';
        panel.id = 'hm-wishlist-picker-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.innerHTML = panelHtml;

        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);

        /* Belt-and-suspenders: keep picker viewport-fixed and in the upper area. */
        backdrop.style.setProperty('position', 'fixed', 'important');
        backdrop.style.setProperty('inset', '0', 'important');
        backdrop.style.setProperty('z-index', '999998', 'important');
        backdrop.style.setProperty('display', 'flex', 'important');
        backdrop.style.setProperty('align-items', 'flex-start', 'important');
        backdrop.style.setProperty('justify-content', 'center', 'important');
        backdrop.style.setProperty(
            'padding-top',
            'max(72px, 10vh, env(safe-area-inset-top, 0px))',
            'important'
        );
        panel.style.setProperty('position', 'relative', 'important');
        panel.style.setProperty('transform', 'none', 'important');
        panel.style.setProperty('top', 'auto', 'important');
        panel.style.setProperty('left', 'auto', 'important');

        let bodyLocked = false;
        if (!document.body.classList.contains('auth-modal-open')) {
            document.body.classList.add('auth-modal-open');
            bodyLocked = true;
        }

        return { backdrop, panel, bodyLocked };
    }

    async function fetchCollections(apiRoot, headers) {
        let collectionsRes;
        try {
            collectionsRes = await fetch(`${apiRoot}/user/wishlists`, { headers });
        } catch {
            notify('Could not reach the server.', 'error');
            return null;
        }
        if (collectionsRes.status === 401) {
            notify('Please sign in again.', 'error');
            return null;
        }
        if (!collectionsRes.ok) {
            notify('Could not load your lists.', 'error');
            return null;
        }
        const wlData = await collectionsRes.json().catch(() => ({}));
        return wlData.collections || [];
    }

    async function postAddToCollection(apiRoot, headers, collectionId, productId) {
        const pid = Number(productId);
        const addRes = await fetch(`${apiRoot}/user/wishlists/${collectionId}/items`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ product_id: pid }),
        });
        const body = await addRes.json().catch(() => ({}));
        return { addRes, body };
    }

    function closeSvg() {
        return '<svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>';
    }

    /**
     * @param {number|string} productId
     * @param {string} [productName]
     * @returns {Promise<{ ok: boolean, already?: boolean, needAuth?: boolean, cancelled?: boolean }>}
     */
    window.hmHerbsPickWishlistAndAddProduct = async function (productId, productName) {
        const pid = Number(productId);
        if (!Number.isFinite(pid) || pid <= 0) {
            notify('Invalid product.', 'error');
            return { ok: false };
        }

        const ctx = await getWishlistAuthContext();
        if (!ctx) return { ok: false, needAuth: true };

        let collections;
        try {
            collections = await fetchCollections(ctx.apiRoot, ctx.headers);
        } catch {
            notify('Could not reach the server.', 'error');
            return { ok: false };
        }
        if (!collections) return { ok: false };
        if (collections.length === 0) {
            notify('No lists yet. Open My Account → Lists to create one.', 'error');
            return { ok: false };
        }

        const titleName = productName ? esc(String(productName)) : 'this product';
        const optionsHtml = collections
            .map((c) => {
                const label = esc(c.name || `List #${c.id}`);
                const def = c.is_default ? ' (default)' : '';
                return `<option value="${Number(c.id)}">${label}${def}</option>`;
            })
            .join('');
        const defaultList = collections.find((c) => c.is_default) || collections[0];
        const defaultId = defaultList ? Number(defaultList.id) : Number(collections[0].id);

        return await new Promise((resolve) => {
            let settled = false;
            const finish = (val) => {
                if (settled) return;
                settled = true;
                resolve(val);
            };

            const panelHtml = `
                <button type="button" class="acct-modal-close" aria-label="Close">${closeSvg()}</button>
                <h3 id="hm-wl-picker-title">Add to list</h3>
                <p class="hm-wl-picker-lede">Choose a list for <strong>${titleName}</strong></p>
                <div class="form-group hm-wl-picker-field">
                    <label for="hm-wl-picker-select" class="hm-wl-picker-label">List</label>
                    <select id="hm-wl-picker-select" class="form-input">${optionsHtml}</select>
                </div>
                <p class="hm-wl-picker-foot">
                    <a href="account.html#wishlists" class="hm-wl-picker-account-link">Manage lists in My Account</a>
                </p>
                <div class="acct-modal-actions">
                    <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
                    <button type="button" class="btn btn-primary" id="hm-wl-picker-save">Add to list</button>
                </div>`.trim();

            const { backdrop, panel, bodyLocked } = openWishlistPickerModal(panelHtml);
            panel.setAttribute('aria-labelledby', 'hm-wl-picker-title');

            const sel = panel.querySelector('#hm-wl-picker-select');
            const saveBtn = panel.querySelector('#hm-wl-picker-save');
            if (!sel || !saveBtn) {
                notify('Could not open the list picker. Please refresh the page.', 'error');
                backdrop.remove();
                if (bodyLocked) document.body.classList.remove('auth-modal-open');
                finish({ ok: false });
                return;
            }
            sel.value = String(defaultId);

            const cleanup = () => {
                document.removeEventListener('keydown', onKey);
                backdrop.remove();
                if (bodyLocked) document.body.classList.remove('auth-modal-open');
            };

            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup();
                    finish({ ok: false, cancelled: true });
                }
            };
            document.addEventListener('keydown', onKey);

            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) {
                    cleanup();
                    finish({ ok: false, cancelled: true });
                }
            });

            panel.addEventListener('click', (e) => {
                if (e.target.closest('.acct-modal-close') || e.target.closest('[data-act="cancel"]')) {
                    cleanup();
                    finish({ ok: false, cancelled: true });
                }
            });

            setTimeout(() => {
                try {
                    sel.focus({ preventScroll: true });
                } catch {
                    try {
                        sel.focus();
                    } catch {
                        /* ignore */
                    }
                }
            }, 30);

            saveBtn.addEventListener('click', async () => {
                if (saveBtn.dataset.loading === '1') return;
                const listId = Number(sel && sel.value ? sel.value : 0);
                if (!listId) {
                    notify('Pick a list.', 'error');
                    return;
                }
                saveBtn.dataset.loading = '1';
                saveBtn.disabled = true;
                try {
                    const { addRes, body } = await postAddToCollection(ctx.apiRoot, ctx.headers, listId, pid);
                    if ((addRes.ok && body.already) || addRes.status === 409) {
                        notify(body.error || 'Already in that list.', 'info');
                        cleanup();
                        finish({ ok: true, already: true });
                        return;
                    }
                    if (!addRes.ok) {
                        notify(body.error || 'Could not add to list.', 'error');
                        saveBtn.disabled = false;
                        delete saveBtn.dataset.loading;
                        return;
                    }
                    notify('Saved to your list.', 'success');
                    cleanup();
                    finish({ ok: true });
                } catch {
                    notify('Could not reach the server.', 'error');
                    saveBtn.disabled = false;
                    delete saveBtn.dataset.loading;
                }
            });
        });
    };

    /**
     * One-tap add to default (or first) list — kept for other pages / scripts.
     * @param {number|string} productId
     * @returns {Promise<{ ok: boolean, already?: boolean, needAuth?: boolean }>}
     */
    window.hmHerbsAddProductToDefaultWishlist = async function (productId) {
        const pid = Number(productId);
        if (!Number.isFinite(pid) || pid <= 0) {
            notify('Invalid product.', 'error');
            return { ok: false };
        }

        const ctx = await getWishlistAuthContext();
        if (!ctx) return { ok: false, needAuth: true };

        let collections;
        try {
            collections = await fetchCollections(ctx.apiRoot, ctx.headers);
        } catch {
            notify('Could not reach the server.', 'error');
            return { ok: false };
        }
        if (!collections) return { ok: false };
        if (collections.length >= 1) {
            return window.hmHerbsPickWishlistAndAddProduct(productId);
        }
        notify('Could not find a list. Try My Account → Lists.', 'error');
        return { ok: false };
    };
})();
