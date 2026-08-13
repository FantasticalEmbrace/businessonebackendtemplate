'use strict';

/**
 * Business One merchant platform — feature flags, branding, phone settings.
 */
(function () {
    const API = '/api/bo';

    async function getJson(url, options) {
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
    }

    function applyNavLocks(features) {
        const websiteOn = Boolean(features.websiteEnabled);
        document.querySelectorAll('[data-feature="website"]').forEach((el) => {
            el.classList.toggle('is-plan-locked', !websiteOn);
            if (!websiteOn) {
                el.setAttribute('data-lock-hint', 'Needs website build');
            } else {
                el.removeAttribute('data-lock-hint');
            }
        });
        document.querySelectorAll('[data-feature="phones"]').forEach((el) => {
            el.style.display = features.phonesEnabled === false ? 'none' : '';
        });
        document.querySelectorAll('[data-feature="gift-cards"]').forEach((el) => {
            el.style.display = features.giftCardsEnabled === false ? 'none' : '';
        });
        const colors = document.getElementById('bo-brand-website-colors');
        if (colors) colors.hidden = !websiteOn;
        const lead = document.getElementById('bo-branding-lead');
        if (lead) {
            lead.textContent = websiteOn
                ? 'Website is on your plan — you can set storefront colors plus POS/receipt branding.'
                : 'POS is your customer-facing face. Store name and logo appear on receipts and the register. Website colors unlock with a website build.';
        }
        const logoSpan = document.querySelector('.sidebar-logo span');
        if (logoSpan && features.brand?.platformName) {
            logoSpan.textContent = features.brand.platformName;
        }
    }

    function fillBranding(b) {
        if (!b) return;
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.value = v || '';
        };
        set('bo-brand-store-name', b.storeName);
        set('bo-brand-tagline', b.tagline);
        set('bo-brand-logo', b.logoUrl);
        set('bo-brand-receipt', b.receiptFooter);
        set('bo-brand-primary', b.primaryColor || '#ff9b1f');
        set('bo-brand-accent', b.accentColor || '#1f82ff');
        if (b.primaryColor) {
            document.documentElement.style.setProperty('--brand-primary', b.primaryColor);
        }
        if (b.accentColor) {
            document.documentElement.style.setProperty('--brand-accent', b.accentColor);
        }
    }

    async function loadPhone(features) {
        if (!features.phonesEnabled) return;
        const msg = document.getElementById('bo-phone-msg');
        try {
            const data = await getJson(`${API}/phone-settings`);
            if (!data.configured) {
                if (msg) msg.textContent = data.message || 'Phone not linked yet — Business One will connect your PBX merchant id.';
                return;
            }
            if (data.ivr?.greeting) {
                document.getElementById('bo-phone-greeting').value = data.ivr.greeting;
            }
            if (data.voicemail) {
                document.getElementById('bo-phone-vm-from').value = data.voicemail.fromAddress || '';
                document.getElementById('bo-phone-vm-email').checked = Boolean(data.voicemail.emailEnabled);
                document.getElementById('bo-phone-vm-attach').checked = data.voicemail.attachAudio !== false;
            }
            if (data.businessHours?.text) {
                document.getElementById('bo-phone-hours').value = data.businessHours.text;
            }
            if (msg) msg.textContent = 'Loaded from Business One Phone.';
        } catch (e) {
            if (msg) msg.textContent = e.message || 'Could not load phone settings (is PBX running on :3040?)';
        }
    }

    function wireForms(features) {
        document.getElementById('bo-branding-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = document.getElementById('bo-branding-msg');
            try {
                const body = {
                    storeName: document.getElementById('bo-brand-store-name').value,
                    tagline: document.getElementById('bo-brand-tagline').value,
                    logoUrl: document.getElementById('bo-brand-logo').value,
                    receiptFooter: document.getElementById('bo-brand-receipt').value
                };
                if (features.websiteEnabled) {
                    body.primaryColor = document.getElementById('bo-brand-primary').value;
                    body.accentColor = document.getElementById('bo-brand-accent').value;
                }
                const data = await getJson(`${API}/branding`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                fillBranding(data.branding);
                if (msg) msg.textContent = 'Branding saved.';
            } catch (err) {
                if (msg) msg.textContent = err.message;
            }
        });

        document.getElementById('bo-brand-reset')?.addEventListener('click', async () => {
            const msg = document.getElementById('bo-branding-msg');
            try {
                const data = await getJson(`${API}/branding/reset`, { method: 'POST' });
                fillBranding(data.branding);
                if (msg) msg.textContent = 'Reset to Business One defaults.';
            } catch (err) {
                if (msg) msg.textContent = err.message;
            }
        });

        document.getElementById('bo-phone-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = document.getElementById('bo-phone-msg');
            try {
                await getJson(`${API}/phone-settings`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ivr: {
                            greeting: document.getElementById('bo-phone-greeting').value,
                            enabled: true
                        },
                        voicemail: {
                            fromAddress: document.getElementById('bo-phone-vm-from').value,
                            emailEnabled: document.getElementById('bo-phone-vm-email').checked,
                            attachAudio: document.getElementById('bo-phone-vm-attach').checked
                        },
                        businessHours: {
                            text: document.getElementById('bo-phone-hours').value
                        }
                    })
                });
                if (msg) msg.textContent = 'Phone settings saved.';
            } catch (err) {
                if (msg) msg.textContent = err.message;
            }
        });
    }

    async function boot() {
        try {
            const features = await getJson(`${API}/features`);
            window.BoMerchantFeatures = features;
            applyNavLocks(features);
            fillBranding(features.branding);
            wireForms(features);
            await loadPhone(features);
        } catch (e) {
            console.warn('[bo-platform]', e.message);
            applyNavLocks({ websiteEnabled: false, phonesEnabled: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
