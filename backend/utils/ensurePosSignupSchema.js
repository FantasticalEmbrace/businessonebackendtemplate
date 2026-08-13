/**
 * POS signup was removed from the HM Herbs Linode storefront.
 * Kept as a no-op so server.js can start without Business One schema migrations.
 */
async function ensurePosSignupSchema() {
    return undefined;
}

module.exports = { ensurePosSignupSchema };
