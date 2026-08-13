'use strict';

const { nmiVaultAddCustomer, nmiVaultSale } = require('./nmiGateway');
const { loadStorePaymentProcessor, resolveProcessorCredentials } = require('./storePaymentProcessor');

async function resolveWebsiteVaultKey(pool) {
    const processor = pool ? await loadStorePaymentProcessor(pool) : 'epi';
    const creds = resolveProcessorCredentials(processor);
    const securityKey = creds.privateKey;
    if (!securityKey) {
        const err = new Error('Card processor not configured');
        err.code = 'NMI_NOT_CONFIGURED';
        throw err;
    }
    return { securityKey, processor: creds.processor || processor };
}

async function listUserVaultCards(pool, userId) {
    const [rows] = await pool.execute(
        `SELECT id, last4, brand, exp_month, exp_year, cardholder_name, is_default, nmi_customer_vault_id, nmi_billing_id
         FROM payment_cards
         WHERE user_id = ? AND is_active = 1 AND deleted_at IS NULL
           AND nmi_customer_vault_id IS NOT NULL AND nmi_billing_id IS NOT NULL
         ORDER BY is_default DESC, created_at DESC`,
        [userId]
    );
    return rows.map((r) => ({
        id: r.id,
        last4: r.last4,
        brand: r.brand,
        expMonth: r.exp_month,
        expYear: r.exp_year,
        cardholderName: r.cardholder_name,
        isDefault: Boolean(r.is_default)
    }));
}

async function saveVaultCard(pool, userId, { paymentToken, setAsDefault, cardholderName }) {
    const { securityKey, processor } = await resolveWebsiteVaultKey(pool);

    const vault = await nmiVaultAddCustomer({ securityKey, paymentToken });
    if (!vault.ok || !vault.customerVaultId || !vault.billingId) {
        const err = new Error(vault.responseText || 'Failed to save card');
        err.code = 'VAULT_ADD_FAILED';
        throw err;
    }

    const last4 = vault.fields?.cc_number ? String(vault.fields.cc_number).slice(-4) : '0000';
    const brand = vault.fields?.cc_type ? String(vault.fields.cc_type).toLowerCase() : 'card';
    const exp = String(vault.fields?.cc_exp || '');
    const expMonth = exp.length >= 2 ? parseInt(exp.slice(0, 2), 10) : null;
    const expYear = exp.length >= 4 ? parseInt(exp.slice(2), 10) : null;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if (setAsDefault) {
            await connection.execute(
                'UPDATE payment_cards SET is_default = 0 WHERE user_id = ? AND is_active = 1',
                [userId]
            );
        }
        const [result] = await connection.execute(
            `INSERT INTO payment_cards (
                user_id, payment_processor, payment_token, last4, brand, exp_month, exp_year,
                cardholder_name, is_default, is_active, nmi_customer_vault_id, nmi_billing_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            [
                userId,
                processor === 'nmi' ? 'nmi' : processor,
                vault.billingId,
                last4,
                brand,
                expMonth,
                expYear,
                cardholderName || null,
                setAsDefault ? 1 : 0,
                vault.customerVaultId,
                vault.billingId
            ]
        );
        await connection.commit();
        return { id: result.insertId, last4, brand, expMonth, expYear };
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }
}

async function chargeVaultCard(pool, userId, cardId, amount) {
    const { securityKey } = await resolveWebsiteVaultKey(pool);
    const [rows] = await pool.execute(
        `SELECT id, nmi_customer_vault_id, nmi_billing_id FROM payment_cards
         WHERE id = ? AND user_id = ? AND is_active = 1 AND deleted_at IS NULL`,
        [cardId, userId]
    );
    const card = rows[0];
    if (!card?.nmi_customer_vault_id || !card?.nmi_billing_id) {
        const err = new Error('Saved card not found');
        err.code = 'CARD_NOT_FOUND';
        throw err;
    }
    const sale = await nmiVaultSale({
        securityKey,
        amount: Number(amount).toFixed(2),
        customerVaultId: card.nmi_customer_vault_id,
        billingId: card.nmi_billing_id
    });
    return sale;
}

async function deleteVaultCard(pool, userId, cardId) {
    await pool.execute(
        'UPDATE payment_cards SET is_active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        [cardId, userId]
    );
}

module.exports = {
    listUserVaultCards,
    saveVaultCard,
    chargeVaultCard,
    deleteVaultCard
};
