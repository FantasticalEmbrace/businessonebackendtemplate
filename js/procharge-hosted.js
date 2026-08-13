'use strict';

/**
 * CardPointe / ProCharge hosted iFrame tokenizer (browser-side).
 * PAN and ACH account numbers never touch Business One servers — only tokens are posted.
 */
(function (global) {
    function parseMessageData(raw) {
        if (raw == null || raw === '') return null;
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(String(raw));
        } catch {
            return null;
        }
    }

    function isAllowedOrigin(eventOrigin, allowedOrigin) {
        if (!allowedOrigin || allowedOrigin === '*') return true;
        return eventOrigin === allowedOrigin;
    }

    function tokenizerUrl(config, mode) {
        const hosted = config?.hostedFields || {};
        if (mode === 'ach') return hosted.achTokenizerUrl || '';
        return hosted.cardTokenizerUrl || '';
    }

    class ProchargeHostedMount {
        constructor() {
            this._listener = null;
            this._iframe = null;
            this._token = null;
            this._mountEl = null;
        }

        mount(opts) {
            this.destroy();
            const {
                mountEl,
                config,
                mode = 'card',
                onToken,
                onError,
                onReady,
                minHeight
            } = opts || {};

            if (!mountEl) {
                onError?.(new Error('Payment mount element is missing'));
                return;
            }

            const hosted = config?.hostedFields || {};
            if (!hosted.enabled) {
                onError?.(
                    new Error(
                        hosted.reason ||
                            'Hosted payment fields are not configured on the billing server yet.'
                    )
                );
                return;
            }

            const url = tokenizerUrl(config, mode);
            if (!url) {
                onError?.(new Error('Hosted tokenizer URL is missing'));
                return;
            }

            this._mountEl = mountEl;
            this._token = null;
            mountEl.innerHTML = '';

            const iframe = document.createElement('iframe');
            iframe.src = url;
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('scrolling', 'no');
            iframe.setAttribute('title', mode === 'ach' ? 'Secure bank account entry' : 'Secure card entry');
            iframe.className = 'bo-procharge-hosted-iframe';
            iframe.style.width = '100%';
            iframe.style.border = '0';
            iframe.style.minHeight = minHeight || (mode === 'ach' ? '120px' : '220px');
            mountEl.appendChild(iframe);
            this._iframe = iframe;

            const allowedOrigin = hosted.messageOrigin || '';

            this._listener = (event) => {
                if (!isAllowedOrigin(event.origin, allowedOrigin)) return;
                const data = parseMessageData(event.data);
                if (!data) return;

                if (data.errorCode || data.errorMessage) {
                    onError?.(new Error(data.errorMessage || data.errorCode || 'Tokenization failed'));
                    return;
                }

                const token = data.message || data.token;
                if (token) {
                    this._token = String(token);
                    onToken?.(this._token, data);
                }
            };

            window.addEventListener('message', this._listener);
            onReady?.();
        }

        getToken() {
            return this._token;
        }

        resetToken() {
            this._token = null;
        }

        reload() {
            if (this._iframe?.src) {
                this._iframe.src = this._iframe.src;
            }
            this._token = null;
        }

        destroy() {
            if (this._listener) {
                window.removeEventListener('message', this._listener);
            }
            this._listener = null;
            this._iframe = null;
            this._token = null;
            if (this._mountEl) this._mountEl.innerHTML = '';
            this._mountEl = null;
        }
    }

    global.BusinessOneProchargeHosted = {
        create() {
            return new ProchargeHostedMount();
        },
        mount(opts) {
            const instance = new ProchargeHostedMount();
            instance.mount(opts);
            return instance;
        }
    };
})(typeof window !== 'undefined' ? window : global);
