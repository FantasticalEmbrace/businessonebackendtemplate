'use strict';

/**
 * NMI Collect.js mount for Business One signup / billing (card + eCheck).
 * Expects clientConfig.collectJs.tokenizationKey + collectJsUrl from platform billing API.
 */
(function (global) {
    function loadCollectScript(url) {
        return new Promise((resolve, reject) => {
            if (global.CollectJS) {
                resolve(global.CollectJS);
                return;
            }
            const existing = document.querySelector('script#bo-nmi-collect-script');
            if (existing) {
                existing.addEventListener('load', () => resolve(global.CollectJS));
                existing.addEventListener('error', () => reject(new Error('Collect.js failed to load')));
                return;
            }
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.id = 'bo-nmi-collect-script';
            s.addEventListener('load', () => resolve(global.CollectJS));
            s.addEventListener('error', () => reject(new Error('Collect.js failed to load')));
            document.head.appendChild(s);
        });
    }

    class BoNmiCollectMount {
        constructor() {
            this._mode = 'card';
            this._token = null;
            this._onToken = null;
            this._onError = null;
            this._ready = false;
        }

        async mount({ mountEl, config, mode = 'card', paymentSelector, onToken, onError }) {
            this.reset();
            this._mode = mode === 'ach' ? 'ach' : 'card';
            this._onToken = onToken;
            this._onError = onError;

            const collect = config?.collectJs || {};
            const key = String(collect.tokenizationKey || '').trim();
            const url = String(collect.collectJsUrl || 'https://secure.nmi.com/token/Collect.js').trim();
            if (!mountEl) throw new Error('Mount element required');
            if (!key) throw new Error('Collect.js tokenization key missing');

            mountEl.innerHTML = '';
            if (this._mode === 'ach') {
                mountEl.innerHTML = `
                  <div class="bo-nmi-fields">
                    <label class="bo-hosted-hint" for="bo-checkname">Name on account</label>
                    <div id="bo-checkname" class="bo-nmi-field form-input"></div>
                    <label class="bo-hosted-hint" for="bo-checkaba">Routing number</label>
                    <div id="bo-checkaba" class="bo-nmi-field form-input"></div>
                    <label class="bo-hosted-hint" for="bo-checkaccount">Account number</label>
                    <div id="bo-checkaccount" class="bo-nmi-field form-input"></div>
                  </div>`;
            } else {
                mountEl.innerHTML = `
                  <div class="bo-nmi-fields">
                    <label class="bo-hosted-hint" for="bo-ccnumber">Card number</label>
                    <div id="bo-ccnumber" class="bo-nmi-field form-input"></div>
                    <div class="bo-procharge-row bo-procharge-row--card-meta">
                      <div>
                        <label class="bo-hosted-hint" for="bo-ccexp">Expiry</label>
                        <div id="bo-ccexp" class="bo-nmi-field form-input"></div>
                      </div>
                      <div>
                        <label class="bo-hosted-hint" for="bo-cvv">CVV</label>
                        <div id="bo-cvv" class="bo-nmi-field form-input"></div>
                      </div>
                      <div class="bo-cc-zip-wrap">
                        <label class="bo-hosted-hint" for="bo-cc-zip">ZIP</label>
                        <input type="text" class="bo-cc-zip" id="bo-cc-zip" name="zip" inputmode="numeric" autocomplete="postal-code" maxlength="10" placeholder="ZIP" required>
                      </div>
                    </div>
                  </div>`;
            }

            // Collect.js reads tokenization key from script data attribute on first load.
            let script = document.querySelector('script#bo-nmi-collect-script');
            if (!script) {
                script = document.createElement('script');
                script.src = url;
                script.async = true;
                script.id = 'bo-nmi-collect-script';
                script.setAttribute('data-tokenization-key', key);
                document.head.appendChild(script);
                await new Promise((resolve, reject) => {
                    script.addEventListener('load', resolve);
                    script.addEventListener('error', () => reject(new Error('Collect.js failed to load')));
                });
            } else if (!global.CollectJS) {
                await loadCollectScript(url);
            }

            const CollectJS = global.CollectJS;
            if (!CollectJS || typeof CollectJS.configure !== 'function') {
                throw new Error('Collect.js is not available');
            }

            const fields =
                this._mode === 'ach'
                    ? {
                          checkname: { selector: '#bo-checkname', title: 'Name on account' },
                          checkaba: { selector: '#bo-checkaba', title: 'Routing number' },
                          checkaccount: { selector: '#bo-checkaccount', title: 'Account number' }
                      }
                      : {
                          ccnumber: { selector: '#bo-ccnumber', title: 'Card number' },
                          ccexp: { selector: '#bo-ccexp', title: 'Card expiration' },
                          cvv: { selector: '#bo-cvv', title: 'CVV' }
                      };

            const configureOpts = global.BusinessOneCollect?.buildConfigureOptions
                ? global.BusinessOneCollect.buildConfigureOptions({
                      fields,
                      paymentSelector: paymentSelector || '#billing-submit',
                      callback: (response) => this._handleToken(response)
                  })
                : {
                      paymentSelector: paymentSelector || '#billing-submit',
                      variant: 'inline',
                      fields,
                      callback: (response) => this._handleToken(response)
                  };

            if (this._mode === 'ach') {
                configureOpts.fieldsAvailableCallback = () => {};
            }

            CollectJS.configure(configureOpts);
            if (this._mode === 'card') this._bindCardZip(mountEl);
            this._ready = true;
            return this;
        }

        _bindCardZip(mountEl) {
            const zip = mountEl.querySelector('#bo-cc-zip');
            if (!zip) return;
            const sanitize = (value) => String(value || '').replace(/[^\d-]/g, '').slice(0, 10);
            zip.addEventListener('input', () => {
                zip.dataset.touched = '1';
                zip.value = sanitize(zip.value);
            });
            const source = document.getElementById('bill-zip') || document.getElementById('ship-zip');
            if (!source) return;
            const copyFromBilling = () => {
                if (zip.dataset.touched) return;
                zip.value = sanitize(source.value);
            };
            copyFromBilling();
            source.addEventListener('input', copyFromBilling);
        }

        _handleToken(response) {
            if (!response || response.tokenType === 'validationError' || !response.token) {
                const msg =
                    response?.errorMessage ||
                    response?.message ||
                    'Could not tokenize payment details. Check the fields and try again.';
                this._token = null;
                if (typeof this._onError === 'function') this._onError(new Error(msg));
                return;
            }
            this._token = String(response.token);
            if (typeof this._onToken === 'function') this._onToken(this._token, response);
        }

        getToken() {
            return this._token;
        }

        reset() {
            this._token = null;
            this._ready = false;
        }

        destroy() {
            this.reset();
        }
    }

    global.BusinessOneNmiCollect = {
        mount(opts) {
            const instance = new BoNmiCollectMount();
            return instance.mount(opts);
        },
        create() {
            return new BoNmiCollectMount();
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
