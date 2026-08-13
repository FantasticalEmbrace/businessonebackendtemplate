/**
 * Shared branded dialogs and toasts for EDSA booking pages (no native alert/confirm).
 */
(function (global) {
    const CLOSE_ICON_SVG =
        '<svg class="cart-close-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/></svg>';

    const SCROLL_LOCK_CLASS = 'edsa-ui-scroll-locked';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    function lockScroll() {
        document.documentElement.classList.add(SCROLL_LOCK_CLASS);
        document.body.classList.add(SCROLL_LOCK_CLASS);
    }

    function unlockScroll() {
        document.documentElement.classList.remove(SCROLL_LOCK_CLASS);
        document.body.classList.remove(SCROLL_LOCK_CLASS);
    }

    /**
     * @returns {Promise<boolean>}
     */
    function showEdsConfirm({
        title = 'Please confirm',
        message = '',
        confirmLabel = 'Confirm',
        cancelLabel = 'Cancel',
        destructive = false,
    } = {}) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (val) => {
                if (settled) return;
                settled = true;
                modal.remove();
                unlockScroll();
                document.removeEventListener('keydown', onKey);
                resolve(val);
            };

            const modal = document.createElement('div');
            modal.className = 'edsa-modal show eds-confirm-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'eds-confirm-title');

            modal.innerHTML = `
                <div class="edsa-modal-overlay" data-eds-confirm-dismiss></div>
                <div class="edsa-modal-content eds-confirm-content">
                    <div class="edsa-modal-header">
                        <h2 id="eds-confirm-title">${escapeHtml(title)}</h2>
                        <button type="button" class="edsa-modal-close" data-eds-confirm-dismiss aria-label="Close">
                            ${CLOSE_ICON_SVG}
                        </button>
                    </div>
                    <div class="edsa-modal-body">
                        <p class="eds-confirm-message">${escapeHtml(message)}</p>
                    </div>
                    <div class="eds-confirm-actions">
                        ${cancelLabel != null && cancelLabel !== '' ? `<button type="button" class="btn btn-secondary" data-eds-confirm-cancel>${escapeHtml(cancelLabel)}</button>` : ''}
                        <button type="button" class="btn ${destructive ? 'btn-danger' : 'btn-primary'}" data-eds-confirm-ok>${escapeHtml(confirmLabel)}</button>
                    </div>
                </div>`;

            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    finish(false);
                }
            };

            document.body.appendChild(modal);
            lockScroll();
            document.addEventListener('keydown', onKey);

            modal.querySelectorAll('[data-eds-confirm-dismiss]').forEach((el) => {
                el.addEventListener('click', () => finish(false));
            });
            const cancelEl = modal.querySelector('[data-eds-confirm-cancel]');
            if (cancelEl) {
                cancelEl.addEventListener('click', () => finish(false));
            }
            modal.querySelector('[data-eds-confirm-ok]').addEventListener('click', () => finish(true));

            const focusBtn = modal.querySelector('[data-eds-confirm-ok]');
            if (focusBtn) {
                setTimeout(() => {
                    try {
                        focusBtn.focus({ preventScroll: true });
                    } catch {
                        focusBtn.focus();
                    }
                }, 50);
            }
        });
    }

    function showEdsAlert({ title = 'Notice', message = '', okLabel = 'OK' } = {}) {
        return new Promise((resolve) => {
            showEdsConfirm({
                title,
                message,
                confirmLabel: okLabel,
                cancelLabel: null,
                destructive: false,
            }).then(() => resolve());
        });
    }

    function showEdsToast(message, type = 'info', durationMs = 5000) {
        const note = document.createElement('div');
        note.className = `eds-toast eds-toast-${type}`;
        note.setAttribute('role', 'status');
        note.innerHTML = `
            <span class="eds-toast-message">${escapeHtml(message)}</span>
            <button type="button" class="eds-toast-close" aria-label="Dismiss">${CLOSE_ICON_SVG}</button>`;

        const remove = () => {
            note.classList.remove('is-visible');
            note.classList.add('is-hiding');
            setTimeout(() => note.remove(), 280);
        };

        const closeBtn = note.querySelector('.eds-toast-close');
        closeBtn.addEventListener('click', remove);
        document.body.appendChild(note);
        requestAnimationFrame(() => {
            note.classList.add('is-visible');
        });

        const t = setTimeout(remove, durationMs);
        closeBtn.addEventListener('click', () => clearTimeout(t));
    }

    global.showEdsConfirm = showEdsConfirm;
    global.showEdsAlert = showEdsAlert;
    global.showEdsToast = showEdsToast;
})(typeof window !== 'undefined' ? window : global);
