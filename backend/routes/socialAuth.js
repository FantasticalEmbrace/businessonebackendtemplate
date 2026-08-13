'use strict';

const express = require('express');
const {
    GOOGLE_SCOPES,
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
} = require('../services/socialOAuth');
const {
    normalizeRegistrationMailingAddress,
    saveRegistrationMailingAddress,
} = require('../utils/saveRegistrationMailingAddress');
const { isUsPhoneDisplay } = require('../utils/usPhoneDisplay');

function failRedirect(base, message, extra = {}) {
    return redirectWithParams(base, { error: message, ...extra });
}

function createCustomerGoogleRoutes(pool, logger, authenticateToken) {
    const router = express.Router();

    router.get('/google/status', (_req, res) => {
        res.json(getProviderStatus());
    });

    router.get('/google/start', (req, res) => {
        if (!isGoogleConfigured()) {
            return res.status(503).json({ error: 'Google sign-in is not configured on the server' });
        }
        const returnTo = safeReturnPath(req.query.returnTo, '/index.html');
        const redirectUri = getGoogleRedirectUri(req, 'customer');
        const state = createOAuthState('customer_google_oauth', { returnTo });
        const client = googleOAuthClient(redirectUri);
        const authUrl = client.generateAuthUrl({
            access_type: 'online',
            scope: GOOGLE_SCOPES,
            state,
            prompt: 'select_account',
            include_granted_scopes: true
        });
        res.redirect(authUrl);
    });

    router.get('/google/callback', async (req, res) => {
        const base = customerCallbackBase();
        try {
            const { code, state, error: oauthError } = req.query;
            if (oauthError) {
                return res.redirect(failRedirect(base, String(oauthError)));
            }
            if (!code || !state) {
                return res.redirect(failRedirect(base, 'Missing Google authorization code'));
            }
            const decoded = verifyOAuthState(state, 'customer_google_oauth');
            const returnTo = safeReturnPath(decoded.returnTo, '/index.html');
            const redirectUri = getGoogleRedirectUri(req, 'customer');
            const profile = await fetchGoogleProfile(String(code), redirectUri);
            const user = await upsertCustomerFromGoogle(pool, profile, logger);
            const sessionUser = storefrontSessionUserFromRow(user);
            const token = issueCustomerJwt(user.id);
            const needsProfile = await customerNeedsProfileCompletion(pool, user);
            res.redirect(
                redirectWithParams(base, {
                    token,
                    user: encodeUserPayload(sessionUser),
                    needsProfile: needsProfile ? '1' : '0',
                    needsDob: needsProfile ? '1' : '0',
                    returnTo
                })
            );
        } catch (error) {
            logger.error('[oauth][customer][google] callback failed', { message: error.message });
            res.redirect(failRedirect(base, error.message || 'Google sign-in failed'));
        }
    });

    router.post('/complete-google-profile', authenticateToken, async (req, res) => {
        try {
            const dateOfBirth = String(req.body?.dateOfBirth || '').trim().slice(0, 10);
            const phone = String(req.body?.phone || '').trim();
            const mailingAddress = req.body?.mailingAddress;

            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
                return res.status(400).json({ error: 'Valid date of birth is required (YYYY-MM-DD)' });
            }
            const dob = new Date(`${dateOfBirth}T12:00:00.000Z`);
            if (Number.isNaN(dob.getTime())) {
                return res.status(400).json({ error: 'Invalid date of birth' });
            }
            const now = new Date();
            const minBirth = new Date(
                Date.UTC(now.getUTCFullYear() - 21, now.getUTCMonth(), now.getUTCDate())
            );
            if (dob > minBirth) {
                return res.status(400).json({ error: 'You must be 21 or older to create an account' });
            }

            if (!phone) {
                return res.status(400).json({ error: 'Phone number is required' });
            }
            if (!isUsPhoneDisplay(phone)) {
                return res.status(400).json({
                    error: 'Phone must be a valid US number in format (555) 555-0100',
                });
            }

            let normalizedAddress;
            try {
                normalizedAddress = normalizeRegistrationMailingAddress(mailingAddress);
            } catch (addrErr) {
                return res.status(400).json({ error: addrErr.message || 'Invalid mailing address' });
            }
            if (!normalizedAddress) {
                return res.status(400).json({
                    error: 'Mailing address is required (street, city, state, and ZIP).',
                });
            }

            const [userRows] = await pool.execute(
                `SELECT id, first_name, last_name FROM users WHERE id = ?`,
                [req.user.id]
            );
            if (!userRows.length) {
                return res.status(404).json({ error: 'Account not found' });
            }
            const userRow = userRows[0];

            await pool.execute(
                `UPDATE users SET date_of_birth = ?, phone = ?, updated_at = NOW() WHERE id = ?`,
                [dateOfBirth, phone, req.user.id]
            );

            const [addrRows] = await pool.execute(
                `SELECT id FROM user_addresses
                  WHERE user_id = ? AND type = 'shipping'
                  ORDER BY is_default DESC, id ASC
                  LIMIT 1`,
                [req.user.id]
            );

            if (addrRows.length) {
                await pool.execute(
                    `UPDATE user_addresses SET
                        first_name = ?, last_name = ?,
                        address_line_1 = ?, address_line_2 = ?,
                        city = ?, state = ?, postal_code = ?, country = ?,
                        is_default = 1
                     WHERE id = ?`,
                    [
                        userRow.first_name,
                        userRow.last_name,
                        normalizedAddress.line1,
                        normalizedAddress.line2 || null,
                        normalizedAddress.city,
                        normalizedAddress.state,
                        normalizedAddress.postal,
                        normalizedAddress.country,
                        addrRows[0].id,
                    ]
                );
            } else {
                await saveRegistrationMailingAddress(pool, req.user.id, {
                    firstName: userRow.first_name,
                    lastName: userRow.last_name,
                    mailingAddress: {
                        addressLine1: normalizedAddress.line1,
                        addressLine2: normalizedAddress.line2,
                        city: normalizedAddress.city,
                        state: normalizedAddress.state,
                        postalCode: normalizedAddress.postal,
                        country: normalizedAddress.country,
                    },
                });
            }

            const [rows] = await pool.execute(
                `SELECT id, email, first_name, last_name, phone, date_of_birth, customer_number
                   FROM users WHERE id = ?`,
                [req.user.id]
            );
            res.json({
                success: true,
                user: storefrontSessionUserFromRow(rows[0]),
            });
        } catch (error) {
            logger.error('[oauth][customer] complete profile failed', { message: error.message });
            res.status(500).json({ error: 'Failed to save profile' });
        }
    });

    return router;
}

function createAdminGoogleRoutes(pool, logger) {
    const router = express.Router();

    router.get('/google/status', (_req, res) => {
        res.json(getProviderStatus());
    });

    router.get('/google/start', (req, res) => {
        if (!isGoogleConfigured()) {
            return res.status(503).json({ error: 'Google sign-in is not configured on the server' });
        }
        const returnTo = safeReturnPath(req.query.returnTo, '/admin.html');
        const redirectUri = getGoogleRedirectUri(req, 'admin');
        const state = createOAuthState('admin_google_oauth', { returnTo });
        const client = googleOAuthClient(redirectUri);
        const authUrl = client.generateAuthUrl({
            access_type: 'online',
            scope: GOOGLE_SCOPES,
            state,
            prompt: 'select_account',
            include_granted_scopes: true
        });
        res.redirect(authUrl);
    });

    router.get('/google/callback', async (req, res) => {
        const base = adminCallbackBase();
        try {
            const { code, state, error: oauthError } = req.query;
            if (oauthError) {
                return res.redirect(failRedirect(base, String(oauthError)));
            }
            if (!code || !state) {
                return res.redirect(failRedirect(base, 'Missing Google authorization code'));
            }
            const decoded = verifyOAuthState(state, 'admin_google_oauth');
            const returnTo = safeReturnPath(decoded.returnTo, '/admin.html');
            const redirectUri = getGoogleRedirectUri(req, 'admin');
            const profile = await fetchGoogleProfile(String(code), redirectUri);
            const admin = await linkAdminFromGoogle(pool, profile);
            const payload = buildAdminLoginPayload(admin);
            res.redirect(
                redirectWithParams(base, {
                    token: payload.token,
                    returnTo
                })
            );
        } catch (error) {
            logger.error('[oauth][admin][google] callback failed', { message: error.message });
            res.redirect(failRedirect(base, error.message || 'Google sign-in failed'));
        }
    });

    return router;
}

module.exports = { createCustomerGoogleRoutes, createAdminGoogleRoutes };
