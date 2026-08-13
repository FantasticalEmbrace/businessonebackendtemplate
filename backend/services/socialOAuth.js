'use strict';

const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { getStorefrontPublicBaseUrl } = require('../utils/storefrontUrl');
const { provisionWebCustomerProfile } = require('../utils/provisionCustomerProfile');
const {
    findCustomerByEmailAnyStatus,
    findCustomerByOAuthAnyStatus,
    loadCustomerRow,
    reactivateCustomerForGoogle,
    reactivateCustomerForLocalSignup
} = require('../utils/customerAccountReactivation');
const {
    normalizeAdminRole,
    allowedSectionsForRole,
    defaultSectionForRole,
    ROLE_LABELS
} = require('../utils/adminRoles');

const GOOGLE_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];

const PROVIDER = 'google';

function getGoogleClientId() {
    return (
        process.env.CUSTOMER_GOOGLE_CLIENT_ID ||
        process.env.GOOGLE_OAUTH_CLIENT_ID ||
        process.env.GBP_CLIENT_ID ||
        ''
    ).trim();
}

function getGoogleClientSecret() {
    return (
        process.env.CUSTOMER_GOOGLE_CLIENT_SECRET ||
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
        process.env.GBP_CLIENT_SECRET ||
        ''
    ).trim();
}

function isGoogleConfigured() {
    return Boolean(getGoogleClientId() && getGoogleClientSecret());
}

function getProviderStatus() {
    return {
        google: {
            enabled: isGoogleConfigured(),
            reason: isGoogleConfigured()
                ? null
                : 'Set GBP_CLIENT_ID and GBP_CLIENT_SECRET (or GOOGLE_OAUTH_*) in backend/.env'
        }
    };
}

function requireJwtSecret() {
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return secret;
}

function safeReturnPath(raw, fallback = '/') {
    const value = String(raw || '').trim();
    if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
    if (value.includes('://')) return fallback;
    return value;
}

function createOAuthState(purpose, extra = {}) {
    return jwt.sign({ purpose, ...extra, ts: Date.now() }, requireJwtSecret(), { expiresIn: '15m' });
}

function verifyOAuthState(state, expectedPurpose) {
    const decoded = jwt.verify(String(state || ''), requireJwtSecret());
    if (decoded.purpose !== expectedPurpose) throw new Error('Invalid OAuth state');
    return decoded;
}

function googleOAuthClient(redirectUri) {
    return new google.auth.OAuth2(getGoogleClientId(), getGoogleClientSecret(), redirectUri);
}

function getGoogleRedirectUri(req, audience) {
    if (audience === 'support') {
        if (process.env.SUPPORT_DESK_GOOGLE_REDIRECT_URI) {
            return String(process.env.SUPPORT_DESK_GOOGLE_REDIRECT_URI).trim();
        }
        return `${getStorefrontPublicBaseUrl()}/api/platform/support/hub/google/callback`;
    }
    const envKey = audience === 'admin' ? 'ADMIN_GOOGLE_REDIRECT_URI' : 'CUSTOMER_GOOGLE_REDIRECT_URI';
    if (process.env[envKey]) return String(process.env[envKey]).trim();

    const prefix =
        audience === 'admin' ? '/api/admin/auth/google/callback' : '/api/auth/google/callback';

    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (!isProd) {
        // Stable dev callback (matches STOREFRONT_PUBLIC_URL / FRONTEND_URL), not browser bar host.
        // Google treats localhost and 127.0.0.1 as different redirect URIs.
        return `${getStorefrontPublicBaseUrl()}${prefix}`;
    }

    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host =
        req.headers['x-forwarded-host'] || req.get('host') || `localhost:${process.env.PORT || 3001}`;
    return `${proto}://${host}${prefix}`;
}

function customerCallbackBase() {
    return `${getStorefrontPublicBaseUrl()}/oauth-callback.html`;
}

function adminCallbackBase() {
    const explicit = String(process.env.ADMIN_APP_URL || '')
        .trim()
        .replace(/\/admin\.html$/i, '');
    if (explicit) return `${explicit.replace(/\/+$/, '')}/admin-oauth-callback.html`;
    return `${getStorefrontPublicBaseUrl()}/admin-oauth-callback.html`;
}

function redirectWithParams(baseUrl, params) {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
        if (value != null && value !== '') url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function storefrontSessionUserFromRow(row) {
    if (!row) return null;
    let dob = row.date_of_birth;
    if (dob instanceof Date) dob = dob.toISOString().slice(0, 10);
    else if (dob != null && String(dob).trim() !== '') dob = String(dob).slice(0, 10);
    else dob = null;
    return {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone != null ? row.phone : null,
        dateOfBirth: dob,
        customerNumber: row.customer_number != null ? row.customer_number : null
    };
}

function issueCustomerJwt(userId) {
    return jwt.sign({ userId }, requireJwtSecret(), { expiresIn: '7d' });
}

function issueAdminJwt(adminId) {
    return jwt.sign({ adminId }, requireJwtSecret(), { expiresIn: '8h' });
}

async function fetchGoogleProfile(code, redirectUri) {
    const client = googleOAuthClient(redirectUri);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    if (!data?.id || !data?.email) {
        throw new Error('Google did not return a verified email address');
    }
    return {
        subject: String(data.id),
        email: String(data.email).trim().toLowerCase(),
        firstName: String(data.given_name || '').trim() || 'Customer',
        lastName: String(data.family_name || '').trim() || 'Account',
        emailVerified: data.verified_email !== false
    };
}

async function findCustomerByOAuth(pool, subject) {
    const [rows] = await pool.execute(
        `SELECT id, email, first_name, last_name, phone, date_of_birth, customer_number, is_active
           FROM users
          WHERE auth_provider = ? AND oauth_subject = ? AND is_active = 1
          LIMIT 1`,
        [PROVIDER, subject]
    );
    return rows[0] || null;
}

async function findCustomerByEmail(pool, email) {
    const [rows] = await pool.execute(
        `SELECT id, email, first_name, last_name, phone, date_of_birth, customer_number, is_active
           FROM users
          WHERE LOWER(TRIM(email)) = ? AND is_active = 1
          LIMIT 1`,
        [email]
    );
    return rows[0] || null;
}

async function upsertCustomerFromGoogle(pool, profile, log) {
    const byOAuth = await findCustomerByOAuthAnyStatus(pool, profile.subject);
    if (byOAuth) {
        if (!byOAuth.is_active) {
            await reactivateCustomerForGoogle(pool, byOAuth.id, profile);
        } else {
            await pool.execute(
                `UPDATE users SET last_login = CURRENT_TIMESTAMP, email_verified = 1 WHERE id = ?`,
                [byOAuth.id]
            );
        }
        return loadCustomerRow(pool, byOAuth.id);
    }

    const activeByEmail = await findCustomerByEmail(pool, profile.email);
    if (activeByEmail) {
        await pool.execute(
            `UPDATE users
                SET auth_provider = ?,
                    oauth_subject = ?,
                    email_verified = 1,
                    last_login = CURRENT_TIMESTAMP,
                    first_name = COALESCE(NULLIF(first_name, ''), ?),
                    last_name = COALESCE(NULLIF(last_name, ''), ?)
              WHERE id = ?`,
            [PROVIDER, profile.subject, profile.firstName, profile.lastName, activeByEmail.id]
        );
        const linked = await findCustomerByOAuth(pool, profile.subject);
        if (linked) return linked;
        return loadCustomerRow(pool, activeByEmail.id);
    }

    const inactiveByEmail = await findCustomerByEmailAnyStatus(pool, profile.email);
    if (inactiveByEmail && !inactiveByEmail.is_active) {
        await reactivateCustomerForGoogle(pool, inactiveByEmail.id, profile);
        return loadCustomerRow(pool, inactiveByEmail.id);
    }

    const [result] = await pool.execute(
        `INSERT INTO users (email, password_hash, auth_provider, oauth_subject, first_name, last_name, email_verified)
         VALUES (?, NULL, ?, ?, ?, ?, 1)`,
        [profile.email, PROVIDER, profile.subject, profile.firstName, profile.lastName]
    );
    const newUserId = result.insertId;
    await provisionWebCustomerProfile(pool, newUserId, log);
    return loadCustomerRow(pool, newUserId);
}

async function findAdminByOAuth(pool, subject) {
    const [rows] = await pool.execute(
        `SELECT id, email, first_name, last_name, role, is_active
           FROM admin_users
          WHERE auth_provider = ? AND oauth_subject = ? AND is_active = 1
          LIMIT 1`,
        [PROVIDER, subject]
    );
    return rows[0] || null;
}

async function findAdminByEmail(pool, email) {
    const [rows] = await pool.execute(
        `SELECT id, email, first_name, last_name, role, is_active
           FROM admin_users
          WHERE LOWER(TRIM(email)) = ? AND is_active = 1
          LIMIT 1`,
        [String(email).trim().toLowerCase()]
    );
    return rows[0] || null;
}

async function linkAdminFromGoogle(pool, profile) {
    let admin = await findAdminByOAuth(pool, profile.subject);
    if (admin) {
        await pool.execute(`UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`, [admin.id]);
        return admin;
    }

    const existing = await findAdminByEmail(pool, profile.email);
    if (!existing) {
        throw new Error(
            'No admin account exists for this Google email. Ask a store admin to create your staff login first.'
        );
    }

    await pool.execute(
        `UPDATE admin_users
            SET auth_provider = ?, oauth_subject = ?, last_login = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [PROVIDER, profile.subject, existing.id]
    );
    const [rows] = await pool.execute(
        `SELECT id, email, first_name, last_name, role, is_active FROM admin_users WHERE id = ?`,
        [existing.id]
    );
    return rows[0];
}

function buildAdminLoginPayload(admin) {
    const role = normalizeAdminRole(admin.role);
    return {
        token: issueAdminJwt(admin.id),
        admin: {
            id: admin.id,
            email: admin.email,
            firstName: admin.first_name,
            lastName: admin.last_name,
            role,
            roleLabel: ROLE_LABELS[role] || role
        },
        allowedSections: allowedSectionsForRole(role),
        defaultSection: defaultSectionForRole(role)
    };
}

function customerNeedsDob(user) {
    return !user?.date_of_birth;
}

async function customerHasShippingAddress(pool, userId) {
    const [rows] = await pool.execute(
        `SELECT id FROM user_addresses WHERE user_id = ? AND type = 'shipping' LIMIT 1`,
        [userId]
    );
    return rows.length > 0;
}

/** Google (and other OAuth) customers must confirm DOB, phone, and a mailing address. */
async function customerNeedsProfileCompletion(pool, user) {
    if (!user?.id) return true;
    if (customerNeedsDob(user)) return true;
    if (!String(user.phone || '').trim()) return true;
    if (!(await customerHasShippingAddress(pool, user.id))) return true;
    return false;
}

function encodeUserPayload(user) {
    return Buffer.from(JSON.stringify(user), 'utf8').toString('base64url');
}

module.exports = {
    GOOGLE_SCOPES,
    PROVIDER,
    getProviderStatus,
    isGoogleConfigured,
    createOAuthState,
    verifyOAuthState,
    googleOAuthClient,
    getGoogleRedirectUri,
    customerCallbackBase,
    adminCallbackBase,
    redirectWithParams,
    safeReturnPath,
    fetchGoogleProfile,
    upsertCustomerFromGoogle,
    linkAdminFromGoogle,
    storefrontSessionUserFromRow,
    issueCustomerJwt,
    buildAdminLoginPayload,
    customerNeedsDob,
    customerNeedsProfileCompletion,
    encodeUserPayload
};
