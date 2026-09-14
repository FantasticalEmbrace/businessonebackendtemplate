'use strict';

/**
 * One Google OAuth connection for Calendar, Drive, and Business Profile.
 * Stores a shared refresh token and mirrors it into legacy gcal/gdrive/gbp keys
 * so existing feature services keep working.
 */
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const SCOPES = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/business.manage'
];

const SHARED_KEYS = {
    refreshToken: 'google_refresh_token',
    connectedEmail: 'google_connected_email',
    connectedAt: 'google_connected_at',
    grantedScopes: 'google_granted_scopes'
};

const LEGACY_TOKEN_KEYS = [
    'gcal_refresh_token',
    'gdrive_refresh_token',
    'gbp_refresh_token'
];

const LEGACY_EMAIL_KEYS = [
    'gcal_connected_email',
    'gdrive_connected_email',
    'gbp_connected_email'
];

const LEGACY_AT_KEYS = ['gcal_connected_at', 'gdrive_connected_at', 'gbp_connected_at'];

function getClientId() {
    return (
        process.env.GOOGLE_OAUTH_CLIENT_ID ||
        process.env.GBP_CLIENT_ID ||
        process.env.GCAL_CLIENT_ID ||
        process.env.GDRIVE_CLIENT_ID ||
        ''
    ).trim();
}

function getClientSecret() {
    return (
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
        process.env.GBP_CLIENT_SECRET ||
        process.env.GCAL_CLIENT_SECRET ||
        process.env.GDRIVE_CLIENT_SECRET ||
        ''
    ).trim();
}

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

class GoogleAccountOAuthService {
    hasClientCredentials() {
        return Boolean(getClientId() && getClientSecret());
    }

    getRedirectUri(req) {
        if (process.env.GOOGLE_ACCOUNT_REDIRECT_URI) {
            return process.env.GOOGLE_ACCOUNT_REDIRECT_URI.trim();
        }
        const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
        const host =
            req?.headers?.['x-forwarded-host'] || req?.get?.('host') || `localhost:${process.env.PORT || 3001}`;
        return `${proto}://${host}/api/admin/settings/google-account/callback`;
    }

    getAdminAppUrl(req) {
        if (process.env.ADMIN_APP_URL) {
            return process.env.ADMIN_APP_URL.trim().replace(/\/$/, '');
        }
        const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
        const host =
            req?.headers?.['x-forwarded-host'] || req?.get?.('host') || `localhost:${process.env.PORT || 3001}`;
        return `${proto}://${host}/admin.html`;
    }

    _oauthClient(redirectUri) {
        return new google.auth.OAuth2(getClientId(), getClientSecret(), redirectUri);
    }

    async _getSetting(pool, keyName) {
        const [rows] = await pool.execute('SELECT value FROM settings WHERE key_name = ? LIMIT 1', [keyName]);
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
        let connectedEmail = '';
        let connectedAt = '';
        let grantedScopes = '';

        if (pool) {
            refreshToken = (await this._getSetting(pool, SHARED_KEYS.refreshToken)) || '';
            connectedEmail = (await this._getSetting(pool, SHARED_KEYS.connectedEmail)) || '';
            connectedAt = (await this._getSetting(pool, SHARED_KEYS.connectedAt)) || '';
            grantedScopes = (await this._getSetting(pool, SHARED_KEYS.grantedScopes)) || '';

            // Migrate: if shared empty, lift any legacy feature token into shared view
            if (!refreshToken) {
                for (const key of LEGACY_TOKEN_KEYS) {
                    const legacy = await this._getSetting(pool, key);
                    if (legacy) {
                        refreshToken = legacy;
                        break;
                    }
                }
            }
            if (!connectedEmail) {
                connectedEmail =
                    (await this._getSetting(pool, 'gcal_connected_email')) ||
                    (await this._getSetting(pool, 'gdrive_connected_email')) ||
                    (await this._getSetting(pool, 'gbp_connected_email')) ||
                    '';
            }
        }

        return { refreshToken, connectedEmail, connectedAt, grantedScopes };
    }

    /** Shared refresh token for Calendar / Drive / GBP feature services. */
    async getSharedRefreshToken(pool) {
        const creds = await this.loadCredentials(pool);
        return creds.refreshToken || '';
    }

    async isConfigured(pool) {
        const creds = await this.loadCredentials(pool);
        return Boolean(this.hasClientCredentials() && creds.refreshToken);
    }

    async getConnectionStatus(pool) {
        const creds = await this.loadCredentials(pool);
        const connected = Boolean(creds.refreshToken);
        let scopes = [];
        try {
            scopes = creds.grantedScopes ? JSON.parse(creds.grantedScopes) : [];
            if (!Array.isArray(scopes)) scopes = [];
        } catch {
            scopes = [];
        }
        return {
            clientConfigured: this.hasClientCredentials(),
            connected,
            connectedEmail: creds.connectedEmail || null,
            connectedAt: creds.connectedAt || null,
            grantedScopes: scopes,
            features: {
                calendar: connected,
                drive: connected,
                businessProfile: connected
            }
        };
    }

    createOAuthState(adminId) {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required for Google OAuth');
        }
        return jwt.sign(
            { purpose: 'google_account_oauth', adminId: Number(adminId) },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
    }

    verifyOAuthState(state) {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required for Google OAuth');
        }
        const decoded = jwt.verify(state, process.env.JWT_SECRET);
        if (decoded?.purpose !== 'google_account_oauth' || !decoded?.adminId) {
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
            scope: SCOPES,
            state,
            include_granted_scopes: true
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
            logger.warn('[integration][google-account] Could not fetch Google account email', {
                error: err.message
            });
        }

        const connectedAt = new Date().toISOString();
        const scopeStr = tokens.scope || SCOPES.join(' ');
        const scopeList = String(scopeStr)
            .split(/\s+/)
            .map((s) => s.trim())
            .filter(Boolean);

        await this._setSetting(
            pool,
            SHARED_KEYS.refreshToken,
            tokens.refresh_token,
            'Shared Google OAuth refresh token (Calendar, Drive, Business Profile)',
            'string'
        );
        if (connectedEmail) {
            await this._setSetting(
                pool,
                SHARED_KEYS.connectedEmail,
                connectedEmail,
                'Google account email for store integrations',
                'string'
            );
        }
        await this._setSetting(
            pool,
            SHARED_KEYS.connectedAt,
            connectedAt,
            'When Google account was connected',
            'string'
        );
        await this._setSetting(
            pool,
            SHARED_KEYS.grantedScopes,
            JSON.stringify(scopeList),
            'Scopes granted on the shared Google connection',
            'string'
        );

        // Mirror into legacy keys so Calendar / Drive / GBP services keep working unchanged.
        for (const key of LEGACY_TOKEN_KEYS) {
            await this._setSetting(pool, key, tokens.refresh_token, `Mirrored from ${SHARED_KEYS.refreshToken}`, 'string');
        }
        if (connectedEmail) {
            for (const key of LEGACY_EMAIL_KEYS) {
                await this._setSetting(pool, key, connectedEmail, `Mirrored from ${SHARED_KEYS.connectedEmail}`, 'string');
            }
        }
        for (const key of LEGACY_AT_KEYS) {
            await this._setSetting(pool, key, connectedAt, `Mirrored from ${SHARED_KEYS.connectedAt}`, 'string');
        }

        // Ensure defaults for feature picks
        const calId = await this._getSetting(pool, 'gcal_calendar_id');
        if (!calId) {
            await this._setSetting(pool, 'gcal_calendar_id', 'primary', 'Google Calendar ID for Scheduling appointments', 'string');
        }

        logger.info('[integration][google-account] Connected', {
            email: connectedEmail || null,
            scopes: scopeList.length
        });

        return { connectedEmail, scopes: scopeList };
    }

    async disconnect(pool) {
        await this._deleteSettings(pool, [
            ...Object.values(SHARED_KEYS),
            ...LEGACY_TOKEN_KEYS,
            ...LEGACY_EMAIL_KEYS,
            ...LEGACY_AT_KEYS
        ]);
        // Keep calendarId, drive root folder, GBP location — reconnect reuses them.
    }

    async getAuthenticatedClient(pool, req) {
        const creds = await this.loadCredentials(pool);
        if (!this.hasClientCredentials()) {
            throw new Error('Google OAuth app is not configured.');
        }
        if (!creds.refreshToken) {
            throw new Error('Google account is not connected');
        }
        const redirectUri = this.getRedirectUri(req);
        const client = this._oauthClient(redirectUri);
        client.setCredentials({ refresh_token: creds.refreshToken });
        return { auth: client, connectedEmail: creds.connectedEmail };
    }

    async handleAuthApiCall(pool, fn) {
        try {
            return await fn();
        } catch (error) {
            if (isOAuthTokenError(error)) {
                await this.disconnect(pool).catch(() => {});
                const err = new Error('Google connection expired. Please connect again in Settings.');
                err.code = 'GOOGLE_TOKEN_EXPIRED';
                throw err;
            }
            throw error;
        }
    }
}

module.exports = new GoogleAccountOAuthService();
module.exports.SCOPES = SCOPES;
module.exports.SHARED_KEYS = SHARED_KEYS;
module.exports.getClientId = getClientId;
module.exports.getClientSecret = getClientSecret;
module.exports.isOAuthTokenError = isOAuthTokenError;
