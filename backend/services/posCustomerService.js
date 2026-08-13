'use strict';

const bcrypt = require('bcrypt');
const { provisionWebCustomerProfile } = require('../utils/provisionCustomerProfile');
const { loadLoyaltyProgramSettings, pointsToDollars } = require('./customerLoyalty');
const { normalizeCode } = require('../utils/giftCardCodes');
const {
    digitsOnly,
    formatPhoneForStorage,
    formatPhoneSearchQuery,
    phoneSearchDigits,
    isUsPhoneDisplayOrEmpty,
    usPhoneDigitsSql
} = require('../utils/usPhoneDisplay');
const groupDiscount = require('./customerGroupDiscount');

function getInStorePlaceholderEmail() {
    return String(process.env.POS_IN_STORE_EMAIL || 'pos-instore@hmherbs.local').trim().toLowerCase();
}

function maskGiftCardCode(code) {
    const c = String(code || '').trim();
    if (c.length <= 4) return c;
    return `${'*'.repeat(Math.max(0, c.length - 4))}${c.slice(-4)}`;
}

function mapCustomerSearchRow(row) {
    const first = row.first_name || '';
    const last = row.last_name || '';
    return {
        id: row.id,
        customerNumber: row.customer_number || null,
        email: row.email,
        firstName: first,
        lastName: last,
        name: `${first} ${last}`.trim() || row.email,
        phone: row.phone || null,
        pointsBalance: Number(row.points_balance) || 0,
        cashBalance: Number(row.cash_balance) || 0,
        giftCardCount: Number(row.gift_card_count) || 0
    };
}

async function searchCustomers(pool, query, limit = 20) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];

    const placeholderEmail = getInStorePlaceholderEmail();
    const cap = Math.min(50, Math.max(1, Number(limit) || 20));
    const like = `%${q}%`;
    const phoneDigits = phoneSearchDigits(q);
    const phoneFormatted = formatPhoneSearchQuery(q);
    const phoneSql = usPhoneDigitsSql('u.phone');

    const params = [placeholderEmail, like, like, like, like];
    const phoneClauses = [];
    if (phoneDigits.length >= 3) {
        phoneClauses.push(`(${phoneSql} LIKE ? AND ${phoneSql} <> '')`);
        params.push(`%${phoneDigits}%`);
    }
    if (phoneFormatted) {
        phoneClauses.push('u.phone LIKE ?');
        params.push(`%${phoneFormatted}%`);
    }

    const phoneClause = phoneClauses.length ? `OR ${phoneClauses.join(' OR ')}` : '';

    const [rows] = await pool.query(
        `SELECT u.id, u.customer_number, u.email, u.first_name, u.last_name, u.phone,
                COALESCE(cl.points_balance, 0) AS points_balance,
                COALESCE(cl.cash_balance, 0) AS cash_balance,
                (SELECT COUNT(*) FROM gift_cards gc
                  WHERE gc.status = 'active' AND gc.current_balance > 0
                    AND (gc.customer_id = u.id OR gc.recipient_email = u.email)) AS gift_card_count
           FROM users u
           LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
          WHERE u.is_active = 1
            AND LOWER(u.email) <> ?
            AND (
                u.email LIKE ?
                OR u.first_name LIKE ?
                OR u.last_name LIKE ?
                OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?
                ${phoneClause}
            )
          ORDER BY u.last_name ASC, u.first_name ASC
          LIMIT ${cap}`,
        params
    );

    return rows.map(mapCustomerSearchRow);
}

async function getCustomerForPos(pool, userId) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) {
        const err = new Error('CUSTOMER_NOT_FOUND');
        err.code = 'CUSTOMER_NOT_FOUND';
        throw err;
    }

    const placeholderEmail = getInStorePlaceholderEmail();
    const [[user]] = await pool.execute(
        `SELECT u.id, u.customer_number, u.email, u.first_name, u.last_name, u.phone,
                u.customer_status, u.tax_exempt, u.tax_exempt_id,
                COALESCE(cl.points_balance, 0) AS points_balance,
                COALESCE(cl.cash_balance, 0) AS cash_balance,
                cl.tier, cl.lifetime_points_earned, cl.lifetime_cash_earned,
                cl.loyalty_enrollment, cl.member_since
           FROM users u
           LEFT JOIN customer_loyalty cl ON cl.user_id = u.id
          WHERE u.id = ? AND u.is_active = 1
          LIMIT 1`,
        [uid]
    );

    if (!user || String(user.email || '').toLowerCase() === placeholderEmail) {
        const err = new Error('CUSTOMER_NOT_FOUND');
        err.code = 'CUSTOMER_NOT_FOUND';
        throw err;
    }

    const [giftCards] = await pool.execute(
        `SELECT id, code, card_type, status, current_balance, currency, expires_at
           FROM gift_cards
          WHERE status = 'active' AND current_balance > 0
            AND (customer_id = ? OR recipient_email = ?)
          ORDER BY current_balance DESC, created_at DESC
          LIMIT 25`,
        [uid, user.email]
    );

    const loyaltySettings = await loadLoyaltyProgramSettings(pool);
    const groupBenefits = await groupDiscount.loadUserGroupBenefits(pool, uid, 'pos');
    const standingPos = groupDiscount.resolvePosStandingDiscount(groupBenefits, 0);

    return {
        id: user.id,
        customerNumber: user.customer_number || null,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        phone: user.phone || null,
        customerStatus: user.customer_status || 'active',
        taxExempt: Boolean(user.tax_exempt),
        taxExemptId: user.tax_exempt_id || null,
        customerGroups: groupBenefits.groups || [],
        groupBenefits: {
            standingDiscount:
                standingPos.percent > 0
                    ? {
                          percent: standingPos.percent,
                          label: standingPos.label,
                          groupName: standingPos.groupName
                      }
                    : null,
            linkedPromotions: groupBenefits.linkedPromotions || [],
            manualPromotions: groupBenefits.manualPromotions || [],
            autoApplyPromotions: groupBenefits.autoApplyPromotions || []
        },
        loyalty: {
            pointsBalance: Number(user.points_balance) || 0,
            cashBalance: Number(user.cash_balance) || 0,
            tier: user.tier || null,
            lifetimePointsEarned: Number(user.lifetime_points_earned) || 0,
            lifetimeCashEarned: Number(user.lifetime_cash_earned) || 0,
            enrollment: user.loyalty_enrollment || 'cash',
            memberSince: user.member_since || null,
            dollarValue: pointsToDollars(Number(user.points_balance) || 0, loyaltySettings)
        },
        giftCards: giftCards.map((gc) => ({
            id: gc.id,
            codeMasked: maskGiftCardCode(gc.code),
            cardType: gc.card_type,
            currentBalance: Number(gc.current_balance),
            currency: gc.currency || 'USD',
            expiresAt: gc.expires_at
        }))
    };
}

async function quickEnrollCustomer(pool, data) {
    const firstName = String(data.firstName || data.first_name || '').trim();
    const lastName = String(data.lastName || data.last_name || '').trim();
    const rawPhone = String(data.phone || '').trim() || null;
    const rawEmail = String(data.email || '').trim().toLowerCase();

    if (!firstName || !lastName) {
        const err = new Error('NAME_REQUIRED');
        err.code = 'NAME_REQUIRED';
        err.message = 'First and last name are required.';
        throw err;
    }
    if (!rawPhone && !rawEmail) {
        const err = new Error('CONTACT_REQUIRED');
        err.code = 'CONTACT_REQUIRED';
        err.message = 'Phone or email is required to create a customer profile.';
        throw err;
    }

    let phone = null;
    if (rawPhone) {
        if (!isUsPhoneDisplayOrEmpty(rawPhone)) {
            const err = new Error('PHONE_FORMAT');
            err.code = 'PHONE_FORMAT';
            err.message = 'Phone must be formatted as (555) 555-0100.';
            throw err;
        }
        phone = formatPhoneForStorage(rawPhone);
        if (!phone) {
            const err = new Error('PHONE_FORMAT');
            err.code = 'PHONE_FORMAT';
            err.message = 'Enter a complete 10-digit US phone number.';
            throw err;
        }
    }

    let email = rawEmail;
    if (!email) {
        email = `pos+${digitsOnly(phone)}@customers.hmherbs.local`;
    }

    const [[existing]] = await pool.execute(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [email]
    );
    if (existing) {
        const err = new Error('EMAIL_EXISTS');
        err.code = 'EMAIL_EXISTS';
        err.message = 'A customer with this email already exists.';
        throw err;
    }

    if (phone) {
        const digits = phoneSearchDigits(phone);
        if (digits.length >= 7) {
            const phoneSql = usPhoneDigitsSql('phone');
            const [phoneHits] = await pool.execute(
                `SELECT id FROM users
                  WHERE is_active = 1
                    AND (${phoneSql} = ? OR phone = ?)
                  LIMIT 1`,
                [digits, phone]
            );
            if (phoneHits[0]) {
                return getCustomerForPos(pool, phoneHits[0].id);
            }
        }
    }

    const passwordHash = await bcrypt.hash(`pos_enroll_${Date.now()}_${Math.random()}`, 10);
    const [result] = await pool.execute(
        `INSERT INTO users (email, password_hash, first_name, last_name, phone, email_verified, is_active)
         VALUES (?, ?, ?, ?, ?, 0, 1)`,
        [email, passwordHash, firstName, lastName, phone]
    );

    const userId = result.insertId;
    await provisionWebCustomerProfile(pool, userId);
    return getCustomerForPos(pool, userId);
}

async function checkGiftCardBalance(pool, { code, pin, giftCardId, userId, staffLookup = false }) {
    const id = giftCardId != null ? Number(giftCardId) : null;
    const uid = userId != null ? Number(userId) : null;

    let card = null;
    if (id && uid) {
        const [[row]] = await pool.execute(
            `SELECT id, code, pin, card_type, status, current_balance, currency, expires_at, customer_id
               FROM gift_cards
              WHERE id = ?
                AND status = 'active'
                AND (
                    customer_id = ?
                    OR recipient_email = (SELECT email FROM users WHERE id = ? LIMIT 1)
                )
              LIMIT 1`,
            [id, uid, uid]
        );
        card = row || null;
    } else {
        const cleanCode = normalizeCode(code);
        if (!cleanCode) {
            const err = new Error('GIFT_CARD_CODE_REQUIRED');
            err.code = 'GIFT_CARD_CODE_REQUIRED';
            throw err;
        }
        const [[row]] = await pool.execute(
            'SELECT id, code, pin, card_type, status, current_balance, currency, expires_at, customer_id FROM gift_cards WHERE code = ? LIMIT 1',
            [cleanCode]
        );
        if (!row) {
            const err = new Error('GIFT_CARD_NOT_FOUND');
            err.code = 'GIFT_CARD_NOT_FOUND';
            throw err;
        }
        if (row.pin && !staffLookup) {
            const pinTrim = pin != null ? String(pin).trim() : '';
            if (!pinTrim || pinTrim !== String(row.pin).trim()) {
                const err = new Error('GIFT_CARD_INVALID_PIN');
                err.code = 'GIFT_CARD_INVALID_PIN';
                throw err;
            }
        }
        card = row;
    }

    if (!card) {
        const err = new Error('GIFT_CARD_NOT_FOUND');
        err.code = 'GIFT_CARD_NOT_FOUND';
        throw err;
    }
    if (card.status !== 'active') {
        const err = new Error('GIFT_CARD_INACTIVE');
        err.code = 'GIFT_CARD_INACTIVE';
        throw err;
    }
    if (card.expires_at && new Date(card.expires_at) < new Date()) {
        const err = new Error('GIFT_CARD_EXPIRED');
        err.code = 'GIFT_CARD_EXPIRED';
        throw err;
    }

    return {
        giftCardId: card.id,
        codeMasked: maskGiftCardCode(card.code),
        currentBalance: Number(card.current_balance),
        currency: card.currency || 'USD',
        requiresPin: Boolean(card.pin)
    };
}

async function resolveCustomerUser(pool, userId) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) return null;

    const placeholderEmail = getInStorePlaceholderEmail();
    const [[user]] = await pool.execute(
        `SELECT id, email, first_name, last_name, phone, tax_exempt, tax_exempt_id
           FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [uid]
    );
    if (!user || String(user.email || '').toLowerCase() === placeholderEmail) return null;
    return user;
}

async function updateCustomerTaxExempt(pool, userId, { taxExempt, taxExemptId }) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) {
        const err = new Error('CUSTOMER_NOT_FOUND');
        err.code = 'CUSTOMER_NOT_FOUND';
        throw err;
    }

    const exempt = Boolean(taxExempt);
    const idRaw = taxExemptId != null ? String(taxExemptId).trim() : '';
    if (exempt && idRaw.length < 3) {
        const err = new Error('TAX_EXEMPT_ID_REQUIRED');
        err.code = 'TAX_EXEMPT_ID_REQUIRED';
        err.message = 'Tax exempt ID is required (at least 3 characters) when tax exempt is enabled.';
        throw err;
    }

    const existing = await resolveCustomerUser(pool, uid);
    if (!existing) {
        const err = new Error('CUSTOMER_NOT_FOUND');
        err.code = 'CUSTOMER_NOT_FOUND';
        throw err;
    }

    await pool.execute(
        `UPDATE users SET tax_exempt = ?, tax_exempt_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [exempt ? 1 : 0, exempt ? idRaw : null, uid]
    );

    return getCustomerForPos(pool, uid);
}

module.exports = {
    searchCustomers,
    getCustomerForPos,
    quickEnrollCustomer,
    checkGiftCardBalance,
    resolveCustomerUser,
    updateCustomerTaxExempt,
    maskGiftCardCode
};
