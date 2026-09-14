'use strict';

const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const SCOPE = 'https://www.googleapis.com/auth/drive.file';

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
    refreshToken: 'gdrive_refresh_token',
    connectedEmail: 'gdrive_connected_email',
    connectedAt: 'gdrive_connected_at',
    rootFolderId: 'gdrive_root_folder_id'
};

function getClientId() {
    return (
        process.env.GOOGLE_OAUTH_CLIENT_ID ||
        process.env.GDRIVE_CLIENT_ID ||
        process.env.GCAL_CLIENT_ID ||
        process.env.GBP_CLIENT_ID ||
        ''
    ).trim();
}

function getClientSecret() {
    return (
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
        process.env.GDRIVE_CLIENT_SECRET ||
        process.env.GCAL_CLIENT_SECRET ||
        process.env.GBP_CLIENT_SECRET ||
        ''
    ).trim();
}

class GoogleDriveOAuthService {
    hasClientCredentials() {
        return Boolean(getClientId() && getClientSecret());
    }

    getRedirectUri(req) {
        if (process.env.GDRIVE_REDIRECT_URI) {
            return process.env.GDRIVE_REDIRECT_URI.trim();
        }
        const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
        const host =
            req?.headers?.['x-forwarded-host'] || req?.get?.('host') || `localhost:${process.env.PORT || 3001}`;
        return `${proto}://${host}/api/admin/settings/google-drive/callback`;
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
        let rootFolderId = '';

        if (pool) {
            refreshToken = (await this._getSetting(pool, SETTINGS_KEYS.refreshToken)) || '';
            connectedEmail = (await this._getSetting(pool, SETTINGS_KEYS.connectedEmail)) || '';
            connectedAt = (await this._getSetting(pool, SETTINGS_KEYS.connectedAt)) || '';
            rootFolderId = (await this._getSetting(pool, SETTINGS_KEYS.rootFolderId)) || '';
            if (!refreshToken) {
                try {
                    const googleAccountOAuth = require('./google-account-oauth');
                    refreshToken = await googleAccountOAuth.getSharedRefreshToken(pool);
                    if (refreshToken && !connectedEmail) {
                        const shared = await googleAccountOAuth.loadCredentials(pool);
                        connectedEmail = shared.connectedEmail || '';
                        connectedAt = shared.connectedAt || connectedAt;
                    }
                } catch (_) {
                    /* optional shared account */
                }
            }
        }

        return { refreshToken, connectedEmail, connectedAt, rootFolderId };
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
            rootFolderId: creds.rootFolderId || null,
            folderPath: 'Business One / Jobs / …',
            readyForUploads: Boolean(this.hasClientCredentials() && creds.refreshToken)
        };
    }

    createOAuthState(adminId) {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required for Google OAuth');
        }
        return jwt.sign(
            { purpose: 'gdrive_oauth', adminId: Number(adminId) },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
    }

    verifyOAuthState(state) {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required for Google OAuth');
        }
        const decoded = jwt.verify(state, process.env.JWT_SECRET);
        if (decoded?.purpose !== 'gdrive_oauth' || !decoded?.adminId) {
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
            logger.warn('[integration][google-drive] Could not fetch Google account email', {
                error: err.message
            });
        }

        await this._setSetting(
            pool,
            SETTINGS_KEYS.refreshToken,
            tokens.refresh_token,
            'Google Drive OAuth refresh token',
            'string'
        );
        if (connectedEmail) {
            await this._setSetting(
                pool,
                SETTINGS_KEYS.connectedEmail,
                connectedEmail,
                'Google account used for job photo Drive storage',
                'string'
            );
        }
        await this._setSetting(
            pool,
            SETTINGS_KEYS.connectedAt,
            new Date().toISOString(),
            'When Google Drive was connected',
            'string'
        );

        return { connectedEmail };
    }

    async disconnect(pool) {
        await this._deleteSettings(pool, Object.values(SETTINGS_KEYS));
    }

    async saveRootFolderId(pool, folderId) {
        const normalized = String(folderId || '').trim();
        if (!normalized) {
            throw new Error('Root folder ID is required');
        }
        await this._setSetting(
            pool,
            SETTINGS_KEYS.rootFolderId,
            normalized,
            'Google Drive root folder for Business One job photos',
            'string'
        );
        return normalized;
    }

    async getAuthenticatedClient(pool, req) {
        const creds = await this.loadCredentials(pool);
        if (!this.hasClientCredentials()) {
            throw new Error('Google Drive OAuth app is not configured.');
        }
        if (!creds.refreshToken) {
            throw new Error('Google Drive is not connected');
        }
        const redirectUri = this.getRedirectUri(req);
        const client = this._oauthClient(redirectUri);
        client.setCredentials({ refresh_token: creds.refreshToken });
        return { auth: client, rootFolderId: creds.rootFolderId || '', connectedEmail: creds.connectedEmail };
    }

    async _handleAuthApiCall(pool, fn) {
        try {
            return await fn();
        } catch (error) {
            if (isOAuthTokenError(error)) {
                await this.disconnect(pool).catch(() => {});
                const err = new Error('Google Drive connection expired. Please connect again in Settings.');
                err.code = 'GOOGLE_TOKEN_EXPIRED';
                throw err;
            }
            throw error;
        }
    }
}

module.exports = new GoogleDriveOAuthService();
module.exports.SETTINGS_KEYS = SETTINGS_KEYS;
module.exports.isOAuthTokenError = isOAuthTokenError;
