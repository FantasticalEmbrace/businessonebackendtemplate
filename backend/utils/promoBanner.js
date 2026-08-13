/**
 * Site-wide promo banner JSON for GET /api/promo-banner (store settings key store_promo_banner).
 */

const PROMO_PRESETS = new Set(['sale', 'flash', 'holiday', 'info', 'custom']);

function sanitizePromoBannerPayload(raw) {
    let parsed = raw;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            parsed = {};
        }
    }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    const preset = PROMO_PRESETS.has(String(parsed.preset || '').toLowerCase())
        ? String(parsed.preset).toLowerCase()
        : 'sale';
    const hex = (v, fallback) => {
        const s = String(v || '').trim();
        return /^#[0-9A-Fa-f]{6}$/.test(s) ? s : fallback;
    };
    const rawIconUrl = String(parsed.iconUrl || '').trim();
    const iconUrl = /^\/uploads\/promo-icons\/[a-zA-Z0-9._-]+$/.test(rawIconUrl) ? rawIconUrl.slice(0, 200) : '';
    return {
        enabled: Boolean(parsed.enabled),
        preset,
        headline: String(parsed.headline || '').trim().slice(0, 200),
        subline: String(parsed.subline || '').trim().slice(0, 280),
        linkUrl: String(parsed.linkUrl || '').trim().slice(0, 500),
        linkLabel: String(parsed.linkLabel || '').trim().slice(0, 80),
        icon: String(parsed.icon || '').trim().slice(0, 12),
        iconUrl,
        customBg: hex(parsed.customBg, '#047857'),
        customText: hex(parsed.customText, '#ffffff'),
        customAccent: hex(parsed.customAccent, '#d4af37'),
    };
}

function disabledPayload() {
    const banner = sanitizePromoBannerPayload({ enabled: false });
    return { banner: { ...banner, enabled: false } };
}

/**
 * Sends 200 JSON for /api/promo-banner. Never throws to the client (logs + disabled banner on failure).
 */
async function handlePromoBannerGet(pool, res, logger) {
    const sendDisabled = () => res.status(200).json(disabledPayload());

    try {
        const [rows] = await pool.query(
            'SELECT `value` FROM `settings` WHERE `key_name` = ? LIMIT 1',
            ['store_promo_banner']
        );
        let raw = rows && rows[0] ? rows[0].value : null;
        if (Buffer.isBuffer(raw)) {
            raw = raw.toString('utf8');
        }
        const banner = sanitizePromoBannerPayload(raw != null && raw !== '' ? raw : '{}');
        if (!banner.enabled || !banner.headline) {
            return sendDisabled();
        }
        return res.status(200).json({ banner });
    } catch (error) {
        if (logger && typeof logger.warn === 'function') {
            const detail =
                typeof logger.formatMysqlError === 'function'
                    ? logger.formatMysqlError(error)
                    : error.code || error.message || String(error);
            logger.warn(`Promo banner: returning disabled banner — ${detail}`);
        }
        return sendDisabled();
    }
}

module.exports = { sanitizePromoBannerPayload, handlePromoBannerGet, disabledPayload };
