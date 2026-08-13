const { google } = require('googleapis');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const SCOPE = 'https://www.googleapis.com/auth/business.manage';
const BASE_URL = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1';

function isOAuthTokenError(error) {
    const msg = String(
        error?.message || error?.response?.data?.error || error?.response?.data?.error_description || ''
    ).toLowerCase();
    return (
        msg.includes('invalid_grant') ||
        msg.includes('token has been expired') ||
        msg.includes('token has been revoked')
    );
}

const SETTINGS_KEYS = {
    refreshToken: 'gbp_refresh_token',
    connectedEmail: 'gbp_connected_email',
    connectedAt: 'gbp_connected_at',
    locationName: 'gbp_location_name',
    apiAccessPending: 'gbp_api_access_pending',
};

const DAY_ALIASES = {
    monday: 'MONDAY',
    mon: 'MONDAY',
    tuesday: 'TUESDAY',
    tue: 'TUESDAY',
    tues: 'TUESDAY',
    wednesday: 'WEDNESDAY',
    wed: 'WEDNESDAY',
    thursday: 'THURSDAY',
    thu: 'THURSDAY',
    thur: 'THURSDAY',
    thurs: 'THURSDAY',
    friday: 'FRIDAY',
    fri: 'FRIDAY',
    saturday: 'SATURDAY',
    sat: 'SATURDAY',
    sunday: 'SUNDAY',
    sun: 'SUNDAY',
};

const ALL_WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class GoogleBusinessProfileService {
    constructor() {
        this.scope = SCOPE;
        this.baseUrl = BASE_URL;
    }

    hasClientCredentials() {
        return Boolean(process.env.GBP_CLIENT_ID && process.env.GBP_CLIENT_SECRET);
    }

    /** Cloud project number from OAuth client id (e.g. 123456789-abc.apps.googleusercontent.com). */
    getOAuthProjectNumber() {
        const id = process.env.GBP_CLIENT_ID || '';
        const m = /^(\d+)-/.exec(id.trim());
        return m ? m[1] : null;
    }

    /** True when Google returns quota_limit_value "0" — project not approved for GBP API use yet. */
    isGbpAccessPendingError(err) {
        const details = err?.response?.data?.error?.details || [];
        return details.some((d) => d?.metadata?.quota_limit_value === '0');
    }

    /** Detailed message for logs / developer scripts (not shown in admin UI). */
    formatApiErrorTechnical(err) {
        const status = err?.response?.status;
        const data = err?.response?.data;
        const msg = data?.error?.message || err?.message || 'Google API request failed';
        const quotaZero = this.isGbpAccessPendingError(err);
        const project = this.getOAuthProjectNumber();

        if (quotaZero) {
            const projectHint = project ? ` (project ${project})` : '';
            return (
                `GBP API access pending${projectHint}: quota 0 QPM. ` +
                'Submit Application for Basic API Access — https://support.google.com/business/contact/api_default'
            );
        }
        if (status === 429) {
            return `Google rate limit (429): ${msg}`;
        }
        if (status === 403) {
            return `Google denied access (403): ${msg}`;
        }
        return msg;
    }

    /** Plain-language message for admin / store staff. */
    formatApiErrorForAdmin(err) {
        if (this.isGbpAccessPendingError(err)) {
            return (
                'Automatic Google hours sync is not turned on for this site yet. ' +
                'Your hours still save on this website. You can update Google Maps at business.google.com in the meantime.'
            );
        }
        const status = err?.response?.status;
        if (status === 429) {
            return 'Google is busy right now. Please wait a minute and refresh this page.';
        }
        if (status === 403) {
            return (
                'This Google account may not have access to your store listing. ' +
                'Try connecting again with the account that manages your business on Google.'
            );
        }
        return 'We could not load your Google Business locations right now. Please try again later.';
    }

    async _axiosGetWithRetry(url, config, { retries = 1, delayMs = 3000 } = {}) {
        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await axios.get(url, config);
            } catch (err) {
                lastErr = err;
                const status = err?.response?.status;
                const quotaZero = err?.response?.data?.error?.details?.some(
                    (d) => d?.metadata?.quota_limit_value === '0'
                );
                if (status !== 429 || quotaZero || attempt >= retries) {
                    throw err;
                }
                await sleep(delayMs);
            }
        }
        throw lastErr;
    }

    getRedirectUri(req) {
        if (process.env.GBP_REDIRECT_URI) {
            return process.env.GBP_REDIRECT_URI.trim();
        }
        const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
        const host = req?.headers?.['x-forwarded-host'] || req?.get?.('host') || `localhost:${process.env.PORT || 3001}`;
        return `${proto}://${host}/api/admin/settings/google-business/callback`;
    }

    getAdminAppUrl(req) {
        if (process.env.ADMIN_APP_URL) {
            return process.env.ADMIN_APP_URL.trim().replace(/\/$/, '');
        }
        const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
        const host = req?.headers?.['x-forwarded-host'] || req?.get?.('host') || `localhost:${process.env.PORT || 3001}`;
        return `${proto}://${host}/admin.html`;
    }

    _oauthClient(redirectUri) {
        return new google.auth.OAuth2(
            process.env.GBP_CLIENT_ID,
            process.env.GBP_CLIENT_SECRET,
            redirectUri || process.env.GBP_REDIRECT_URI || 'http://localhost:3001/api/admin/settings/google-business/callback'
        );
    }

    async _getSetting(pool, keyName) {
        const [rows] = await pool.execute(
            'SELECT value FROM settings WHERE key_name = ? LIMIT 1',
            [keyName]
        );
        return rows?.[0]?.value || '';
    }

    async _setSetting(pool, keyName, value, description, type = 'string') {
        await pool.execute(
            `INSERT INTO settings (key_name, value, description, type)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
            [keyName, value ?? '', description || keyName, type]
        );
    }

    async _deleteSettings(pool, keyNames) {
        if (!keyNames.length) return;
        const placeholders = keyNames.map(() => '?').join(', ');
        await pool.execute(`DELETE FROM settings WHERE key_name IN (${placeholders})`, keyNames);
    }

    async loadCredentials(pool) {
        let refreshToken = '';
        let locationName = '';
        let connectedEmail = '';
        let connectedAt = '';

        if (pool) {
            refreshToken = (await this._getSetting(pool, SETTINGS_KEYS.refreshToken)) || '';
            locationName = (await this._getSetting(pool, SETTINGS_KEYS.locationName)) || '';
            connectedEmail = (await this._getSetting(pool, SETTINGS_KEYS.connectedEmail)) || '';
            connectedAt = (await this._getSetting(pool, SETTINGS_KEYS.connectedAt)) || '';
        }

        if (!refreshToken && process.env.GBP_REFRESH_TOKEN) {
            refreshToken = process.env.GBP_REFRESH_TOKEN;
        }
        if (!locationName && process.env.GBP_LOCATION_NAME) {
            locationName = process.env.GBP_LOCATION_NAME;
        }

        return { refreshToken, locationName, connectedEmail, connectedAt };
    }

    async isConfigured(pool) {
        const creds = await this.loadCredentials(pool);
        return Boolean(
            this.hasClientCredentials() &&
            creds.refreshToken &&
            creds.locationName
        );
    }

    async isApiAccessPending(pool) {
        if (!pool) return false;
        return (await this._getSetting(pool, SETTINGS_KEYS.apiAccessPending)) === '1';
    }

    async setApiAccessPending(pool, pending) {
        if (!pool) return;
        await this._setSetting(
            pool,
            SETTINGS_KEYS.apiAccessPending,
            pending ? '1' : '0',
            'Google Business Profile API access pending (quota 0 until Google approves project)',
            'string'
        );
    }

    async getConnectionStatus(pool) {
        const creds = await this.loadCredentials(pool);
        const connected = Boolean(creds.refreshToken);
        const apiAccessPending = connected && (await this.isApiAccessPending(pool));
        return {
            clientConfigured: this.hasClientCredentials(),
            connected,
            connectedEmail: creds.connectedEmail || null,
            connectedAt: creds.connectedAt || null,
            locationName: creds.locationName || null,
            apiAccessPending,
            readyToSync: Boolean(
                this.hasClientCredentials() &&
                creds.refreshToken &&
                creds.locationName &&
                !apiAccessPending
            ),
        };
    }

    createOAuthState(adminId) {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required for Google OAuth');
        }
        return jwt.sign(
            { purpose: 'gbp_oauth', adminId: Number(adminId) },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
    }

    verifyOAuthState(state) {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required for Google OAuth');
        }
        const decoded = jwt.verify(state, process.env.JWT_SECRET);
        if (decoded?.purpose !== 'gbp_oauth' || !decoded?.adminId) {
            throw new Error('Invalid OAuth state');
        }
        return decoded;
    }

    getAuthorizationUrl(req, adminId) {
        if (!this.hasClientCredentials()) {
            throw new Error('Google OAuth is not configured');
        }
        const redirectUri = this.getRedirectUri(req);
        const client = this._oauthClient(redirectUri);
        const state = this.createOAuthState(adminId);
        const authUrl = client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [SCOPE],
            state,
            include_granted_scopes: true,
        });
        return { authUrl, redirectUri, state };
    }

    async exchangeCodeAndStore(pool, code, req) {
        const redirectUri = this.getRedirectUri(req);
        const client = this._oauthClient(redirectUri);
        const { tokens } = await client.getToken(code);
        if (!tokens?.refresh_token) {
            throw new Error(
                'No refresh token from Google. Revoke app access in the Google account and connect again.'
            );
        }

        client.setCredentials(tokens);
        let connectedEmail = '';
        try {
            const oauth2 = google.oauth2({ version: 'v2', auth: client });
            const { data } = await oauth2.userinfo.get();
            connectedEmail = data?.email || '';
        } catch (err) {
            logger.warn('[integration][google-business] Could not fetch Google account email', {
                error: err.message,
            });
        }

        await this._setSetting(
            pool,
            SETTINGS_KEYS.refreshToken,
            tokens.refresh_token,
            'Google Business Profile OAuth refresh token',
            'string'
        );
        if (connectedEmail) {
            await this._setSetting(
                pool,
                SETTINGS_KEYS.connectedEmail,
                connectedEmail,
                'Google account used for Business Profile sync',
                'string'
            );
        }
        await this._setSetting(
            pool,
            SETTINGS_KEYS.connectedAt,
            new Date().toISOString(),
            'When Google Business Profile was connected',
            'string'
        );

        return { connectedEmail };
    }

    async disconnect(pool) {
        await this._deleteSettings(pool, Object.values(SETTINGS_KEYS));
    }

    async saveLocationName(pool, locationName) {
        const normalized = String(locationName || '').trim();
        if (!normalized) {
            throw new Error('Location ID is required');
        }
        if (!/^locations\/\d+$/.test(normalized)) {
            throw new Error('Invalid location ID format');
        }
        await this._setSetting(
            pool,
            SETTINGS_KEYS.locationName,
            normalized,
            'Google Business Profile location resource name',
            'string'
        );
        return normalized;
    }

    /** OAuth client when connected (refresh token only). Used to list accounts/locations. */
    async _oauthClientConnected(pool, req) {
        const creds = await this.loadCredentials(pool);
        if (!this.hasClientCredentials()) {
            throw new Error('Google Business Profile OAuth is not configured');
        }
        if (!creds.refreshToken) {
            throw new Error('Google Business Profile is not connected');
        }
        const redirectUri = this.getRedirectUri(req);
        const client = this._oauthClient(redirectUri);
        client.setCredentials({ refresh_token: creds.refreshToken });
        return { client, creds };
    }

    async _oauthClientWithCredentials(pool, req) {
        const { client, creds } = await this._oauthClientConnected(pool, req);
        if (!creds.locationName) {
            throw new Error('Google Business Profile location is not set');
        }
        return { client, locationName: creds.locationName };
    }

    async _accessToken(pool, req, { requireLocation = true } = {}) {
        try {
            const { client } = requireLocation
                ? await this._oauthClientWithCredentials(pool, req)
                : await this._oauthClientConnected(pool, req);
            const tokenResult = await client.getAccessToken();
            const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;
            if (!token) throw new Error('Unable to obtain Google OAuth access token');
            return token;
        } catch (error) {
            if (isOAuthTokenError(error)) {
                await this.disconnect(pool).catch(() => {});
                const err = new Error(
                    'Google Business Profile connection expired. Please connect again in Settings.'
                );
                err.code = 'GOOGLE_TOKEN_EXPIRED';
                throw err;
            }
            throw error;
        }
    }

    _toTimeParts(hoursText = '') {
        const text = String(hoursText || '').trim().toLowerCase();
        if (!text || text === 'closed') return null;
        const twentyFourHour = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (twentyFourHour) {
            return { hours: Number(twentyFourHour[1]), minutes: Number(twentyFourHour[2]), seconds: 0, nanos: 0 };
        }
        const m = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
        if (!m) return null;
        let hour = Number(m[1]);
        const minute = Number(m[2] || '0');
        const suffix = m[3];
        if (suffix === 'pm' && hour !== 12) hour += 12;
        if (suffix === 'am' && hour === 12) hour = 0;
        if (hour > 23 || minute > 59) return null;
        return { hours: hour, minutes: minute, seconds: 0, nanos: 0 };
    }

    _parseHoursRange(text) {
        const raw = String(text || '').trim();
        if (!raw || /closed/i.test(raw)) return null;

        const twelveHourRange = raw.match(
            /(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i
        );
        if (twelveHourRange) {
            const openTime = this._toTimeParts(twelveHourRange[1].trim());
            const closeTime = this._toTimeParts(twelveHourRange[2].trim());
            if (openTime && closeTime) return { openTime, closeTime };
        }

        const twentyFourRange = raw.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
        if (twentyFourRange) {
            const openTime = this._toTimeParts(twentyFourRange[1].trim());
            const closeTime = this._toTimeParts(twentyFourRange[2].trim());
            if (openTime && closeTime) return { openTime, closeTime };
        }

        return null;
    }

    _daysFromSpec(spec) {
        const normalized = String(spec || '').trim().toLowerCase();
        if (!normalized) return [];
        if (/closed/.test(normalized)) return [];

        const rangeMatch = normalized.match(/^([a-z]+)\s*[-–]\s*([a-z]+)$/);
        if (rangeMatch) {
            const start = DAY_ALIASES[rangeMatch[1]];
            const end = DAY_ALIASES[rangeMatch[2]];
            if (!start || !end) return [];
            const startIdx = ALL_WEEKDAYS.indexOf(start);
            const endIdx = ALL_WEEKDAYS.indexOf(end);
            if (startIdx < 0 || endIdx < 0) return [];
            if (startIdx <= endIdx) {
                return ALL_WEEKDAYS.slice(startIdx, endIdx + 1);
            }
            return ALL_WEEKDAYS.slice(startIdx).concat(ALL_WEEKDAYS.slice(0, endIdx + 1));
        }

        const single = DAY_ALIASES[normalized.replace(/:.*$/, '').trim()];
        return single ? [single] : [];
    }

    _daysMentionedInText(text) {
        const found = new Set();
        const lower = String(text || '').toLowerCase();
        Object.entries(DAY_ALIASES).forEach(([alias, enumDay]) => {
            const re = new RegExp(`\\b${alias}\\b`, 'i');
            if (re.test(lower)) found.add(enumDay);
        });
        const rangeMatch = lower.match(/\b([a-z]+)\s*[-–]\s*([a-z]+)\b/);
        if (rangeMatch) {
            return this._daysFromSpec(`${rangeMatch[1]}-${rangeMatch[2]}`);
        }
        return [...found];
    }

    buildRegularHoursPeriods({ weekdays = '', saturday = '', sunday = '' } = {}) {
        const periods = [];
        const seen = new Set();
        const addPeriods = (days, range) => {
            if (!range || !days.length) return;
            days.forEach((day) => {
                const key = `${day}:${range.openTime.hours}:${range.openTime.minutes}:${range.closeTime.hours}:${range.closeTime.minutes}`;
                if (seen.has(key)) return;
                seen.add(key);
                periods.push({
                    openDay: day,
                    openTime: range.openTime,
                    closeDay: day,
                    closeTime: range.closeTime,
                });
            });
        };

        const weekdayRange = this._parseHoursRange(weekdays);
        if (weekdayRange) {
            let days = this._daysFromSpec(weekdays);
            if (!days.length) {
                const rangeInText = String(weekdays).toLowerCase().match(/\b([a-z]+)\s*[-–]\s*([a-z]+)\b/);
                if (rangeInText) {
                    days = this._daysFromSpec(`${rangeInText[1]}-${rangeInText[2]}`);
                }
            }
            if (!days.length) {
                days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
            }
            addPeriods(days, weekdayRange);
        }

        const saturdayRange = this._parseHoursRange(saturday);
        if (saturdayRange) {
            let days = this._daysMentionedInText(saturday);
            if (!days.length) days = ['SATURDAY'];
            addPeriods(days.filter((d) => d === 'SATURDAY'), saturdayRange);
        }

        const sundayRange = this._parseHoursRange(sunday);
        if (sundayRange) {
            let days = this._daysMentionedInText(sunday);
            if (!days.length) days = ['SUNDAY'];
            addPeriods(days.filter((d) => d === 'SUNDAY'), sundayRange);
        }

        return periods;
    }

    _buildSpecialHourPeriod(entry) {
        const date = String(entry?.date || '');
        if (!date) return null;
        const [year, month, day] = date.split('-').map((x) => Number(x));
        if (!year || !month || !day) return null;

        const isClosed = entry?.isClosed === true || /closed/i.test(String(entry?.hours || '').trim());
        if (isClosed) {
            return { closedDate: { year, month, day } };
        }

        const openDirect = this._toTimeParts(entry?.openTime || '');
        const closeDirect = this._toTimeParts(entry?.closeTime || '');
        if (openDirect && closeDirect) {
            return {
                startDate: { year, month, day },
                openTime: openDirect,
                closeTime: closeDirect,
            };
        }

        const hoursText = String(entry?.hours || 'Closed').trim();
        const range = hoursText.match(/^(.+)\s*-\s*(.+)$/i);
        if (!range) {
            return { closedDate: { year, month, day } };
        }

        const openTime = this._toTimeParts(range[1]);
        const closeTime = this._toTimeParts(range[2]);
        if (!openTime || !closeTime) {
            return { closedDate: { year, month, day } };
        }

        return {
            startDate: { year, month, day },
            openTime,
            closeTime,
        };
    }

    async listLocations(pool, req) {
        const token = await this._accessToken(pool, req, { requireLocation: false });
        let accountsRes;
        try {
            accountsRes = await this._axiosGetWithRetry(
                `${ACCOUNTS_URL}/accounts`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 20000,
                },
                { retries: 1, delayMs: 5000 }
            );
        } catch (err) {
            if (err?.code === 'GOOGLE_TOKEN_EXPIRED') {
                throw err;
            }
            if (this.isGbpAccessPendingError(err)) {
                await this.setApiAccessPending(pool, true);
            }
            logger.warn('[integration][google-business] List locations failed', {
                detail: this.formatApiErrorTechnical(err),
            });
            throw new Error(this.formatApiErrorForAdmin(err));
        }
        await this.setApiAccessPending(pool, false);
        const accounts = accountsRes.data?.accounts || [];
        const locations = [];

        for (const account of accounts) {
            const accountName = account.name;
            if (!accountName) continue;
            try {
                const locRes = await this._axiosGetWithRetry(
                    `${BASE_URL}/${accountName}/locations`,
                    {
                        params: { readMask: 'name,title,storefrontAddress' },
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: 20000,
                    },
                    { retries: 0 }
                );
                const list = locRes.data?.locations || [];
                list.forEach((loc) => {
                    const addr = loc.storefrontAddress;
                    const addressLine = addr
                        ? [addr.addressLines?.[0], addr.locality, addr.administrativeArea, addr.postalCode]
                              .filter(Boolean)
                              .join(', ')
                        : '';
                    locations.push({
                        name: loc.name,
                        title: loc.title || loc.name,
                        accountName,
                        address: addressLine,
                    });
                });
            } catch (err) {
                logger.warn('[integration][google-business] Could not list locations for account', {
                    account: accountName,
                    error: err.message,
                });
            }
        }

        return locations;
    }

    async syncHours(pool, req, { regularHours, holidaySchedule = [] } = {}) {
        const { locationName } = await this._oauthClientWithCredentials(pool, req);
        const regularPeriods = this.buildRegularHoursPeriods(regularHours || {});
        if (!regularPeriods.length) {
            throw new Error('Could not parse regular hours from store settings');
        }

        const specialPeriods = (Array.isArray(holidaySchedule) ? holidaySchedule : [])
            .map((item) => this._buildSpecialHourPeriod(item))
            .filter(Boolean);

        const token = await this._accessToken(pool, req);
        const url = `${BASE_URL}/${locationName}?updateMask=regularHours,specialHours`;
        const payload = {
            name: locationName,
            regularHours: { periods: regularPeriods },
            specialHours: { specialHourPeriods: specialPeriods },
        };

        let response;
        try {
            response = await axios.patch(url, payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                timeout: 20000,
            });
        } catch (err) {
            logger.warn('[integration][google-business] Sync hours failed', {
                detail: this.formatApiErrorTechnical(err),
            });
            throw new Error(this.formatApiErrorForAdmin(err));
        }

        logger.info('[integration][google-business] Synced regular and special hours', {
            location: locationName,
            regularPeriodCount: regularPeriods.length,
            specialPeriodCount: specialPeriods.length,
            status: response.status,
        });

        return {
            ok: true,
            location: locationName,
            regularPeriodCount: regularPeriods.length,
            specialPeriodCount: specialPeriods.length,
        };
    }

}

module.exports = new GoogleBusinessProfileService();
