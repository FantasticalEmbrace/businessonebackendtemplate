const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const SCOPE = 'https://www.googleapis.com/auth/calendar';

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
    refreshToken: 'gcal_refresh_token',
    connectedEmail: 'gcal_connected_email',
    connectedAt: 'gcal_connected_at',
    calendarId: 'gcal_calendar_id',
};

function getClientId() {
    return (
        process.env.GCAL_CLIENT_ID ||
        process.env.GBP_CLIENT_ID ||
        process.env.GOOGLE_OAUTH_CLIENT_ID ||
        ''
    ).trim();
}

function getClientSecret() {
    return (
        process.env.GCAL_CLIENT_SECRET ||
        process.env.GBP_CLIENT_SECRET ||
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
        ''
    ).trim();
}

class GoogleCalendarOAuthService {
    hasClientCredentials() {
        return Boolean(getClientId() && getClientSecret());
    }

    getRedirectUri(req) {
        if (process.env.GCAL_REDIRECT_URI) {
            return process.env.GCAL_REDIRECT_URI.trim();
        }
        const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
        const host = req?.headers?.['x-forwarded-host'] || req?.get?.('host') || `localhost:${process.env.PORT || 3001}`;
        return `${proto}://${host}/api/admin/settings/google-calendar/callback`;
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
        return new google.auth.OAuth2(getClientId(), getClientSecret(), redirectUri);
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
        let calendarId = '';
        let connectedEmail = '';
        let connectedAt = '';

        if (pool) {
            refreshToken = (await this._getSetting(pool, SETTINGS_KEYS.refreshToken)) || '';
            calendarId = (await this._getSetting(pool, SETTINGS_KEYS.calendarId)) || '';
            connectedEmail = (await this._getSetting(pool, SETTINGS_KEYS.connectedEmail)) || '';
            connectedAt = (await this._getSetting(pool, SETTINGS_KEYS.connectedAt)) || '';
        }

        if (!refreshToken && process.env.GCAL_REFRESH_TOKEN) {
            refreshToken = process.env.GCAL_REFRESH_TOKEN;
        }
        if (!calendarId && process.env.GOOGLE_CALENDAR_ID) {
            calendarId = process.env.GOOGLE_CALENDAR_ID;
        }

        return {
            refreshToken,
            calendarId: calendarId || 'primary',
            connectedEmail,
            connectedAt,
        };
    }

    async isConfigured(pool) {
        const creds = await this.loadCredentials(pool);
        return Boolean(this.hasClientCredentials() && creds.refreshToken);
    }

    async getConnectionStatus(pool) {
        const creds = await this.loadCredentials(pool);
        const connected = Boolean(creds.refreshToken);
        return {
            clientConfigured: this.hasClientCredentials(),
            connected,
            connectedEmail: creds.connectedEmail || null,
            connectedAt: creds.connectedAt || null,
            calendarId: creds.calendarId || null,
            readyForEdsa: Boolean(this.hasClientCredentials() && creds.refreshToken),
        };
    }

    createOAuthState(adminId) {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required for Google OAuth');
        }
        return jwt.sign(
            { purpose: 'gcal_oauth', adminId: Number(adminId) },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
    }

    verifyOAuthState(state) {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required for Google OAuth');
        }
        const decoded = jwt.verify(state, process.env.JWT_SECRET);
        if (decoded?.purpose !== 'gcal_oauth' || !decoded?.adminId) {
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
                'Google did not return a refresh token. Revoke app access in your Google Account and connect again.'
            );
        }

        client.setCredentials(tokens);
        let connectedEmail = '';
        try {
            const oauth2 = google.oauth2({ version: 'v2', auth: client });
            const { data } = await oauth2.userinfo.get();
            connectedEmail = data?.email || '';
        } catch (err) {
            logger.warn('[integration][google-calendar] Could not fetch Google account email', {
                error: err.message,
            });
        }

        await this._setSetting(
            pool,
            SETTINGS_KEYS.refreshToken,
            tokens.refresh_token,
            'Google Calendar OAuth refresh token',
            'string'
        );
        if (connectedEmail) {
            await this._setSetting(
                pool,
                SETTINGS_KEYS.connectedEmail,
                connectedEmail,
                'Google account used for EDSA calendar sync',
                'string'
            );
        }
        await this._setSetting(
            pool,
            SETTINGS_KEYS.connectedAt,
            new Date().toISOString(),
            'When Google Calendar was connected',
            'string'
        );

        const existingCalendarId = await this._getSetting(pool, SETTINGS_KEYS.calendarId);
        if (!existingCalendarId) {
            await this._setSetting(
                pool,
                SETTINGS_KEYS.calendarId,
                'primary',
                'Google Calendar ID for EDSA appointments',
                'string'
            );
        }

        return { connectedEmail };
    }

    async disconnect(pool) {
        await this._deleteSettings(pool, Object.values(SETTINGS_KEYS));
    }

    async saveCalendarId(pool, calendarId) {
        const normalized = String(calendarId || '').trim();
        if (!normalized) {
            throw new Error('Calendar ID is required');
        }
        await this._setSetting(
            pool,
            SETTINGS_KEYS.calendarId,
            normalized,
            'Google Calendar ID for EDSA appointments',
            'string'
        );
        return normalized;
    }

    async getAuthenticatedClient(pool, req) {
        const creds = await this.loadCredentials(pool);
        if (!this.hasClientCredentials()) {
            throw new Error('Google Calendar OAuth app is not configured.');
        }
        if (!creds.refreshToken) {
            throw new Error('Google Calendar is not connected');
        }
        const redirectUri = this.getRedirectUri(req);
        const client = this._oauthClient(redirectUri);
        client.setCredentials({ refresh_token: creds.refreshToken });
        return { auth: client, calendarId: creds.calendarId || 'primary' };
    }

    async _handleAuthApiCall(pool, fn) {
        try {
            return await fn();
        } catch (error) {
            if (isOAuthTokenError(error)) {
                await this.disconnect(pool).catch(() => {});
                const err = new Error('Google Calendar connection expired. Please connect again in Settings.');
                err.code = 'GOOGLE_TOKEN_EXPIRED';
                throw err;
            }
            throw error;
        }
    }

    async listCalendars(pool, req) {
        return this._handleAuthApiCall(pool, async () => {
            const { auth } = await this.getAuthenticatedClient(pool, req);
            const calendar = google.calendar({ version: 'v3', auth });
            const response = await calendar.calendarList.list({ minAccessRole: 'writer' });
            const items = response.data?.items || [];
            return items.map((item) => ({
                id: item.id,
                summary: item.summary || item.id,
                primary: Boolean(item.primary),
                accessRole: item.accessRole || null,
            }));
        });
    }
}

module.exports = new GoogleCalendarOAuthService();
