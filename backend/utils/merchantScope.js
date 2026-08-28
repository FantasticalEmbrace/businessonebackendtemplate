'use strict';

/**
 * Helpers to scope SQL to the current shop when shared tenancy is on.
 */

function merchantIdFromReq(req) {
    return req.merchantId || req.merchantAccount?.id || req.admin?.merchant_id || null;
}

/** Append AND <alias.>merchant_id = ? when a merchant is in context. */
function andMerchantId(merchantId, sqlFragment, params = [], column = 'merchant_id') {
    const mid = merchantId || null;
    if (!mid) return { sql: sqlFragment, params };
    return {
        sql: `${sqlFragment} AND ${column} = ?`,
        params: [...params, mid]
    };
}

function andMerchant(req, sqlFragment, params = [], column = 'merchant_id') {
    return andMerchantId(merchantIdFromReq(req), sqlFragment, params, column);
}

function merchantInsertColumns(merchantId, columnsSql, valuesPlaceholders, params) {
    const mid = merchantId || null;
    if (!mid) {
        return { columnsSql, valuesPlaceholders, params };
    }
    return {
        columnsSql: `${columnsSql}, merchant_id`,
        valuesPlaceholders: `${valuesPlaceholders}, ?`,
        params: [...params, mid]
    };
}

module.exports = {
    merchantIdFromReq,
    andMerchant,
    andMerchantId,
    merchantInsertColumns
};
