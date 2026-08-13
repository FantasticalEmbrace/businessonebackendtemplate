'use strict';

const KEYS = {
    globalLowStockThreshold: 'inventory_global_low_stock_threshold',
    allowOversell: 'inventory_allow_oversell',
    hideOutOfStock: 'inventory_hide_out_of_stock'
};

const DEFAULTS = {
    globalLowStockThreshold: 5,
    allowOversell: false,
    hideOutOfStock: false
};

function parseBool(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
}

function isTracked(product) {
    return parseBool(product?.track_inventory);
}

function allowsOversell(product, settings) {
    if (parseBool(product?.allow_backorder)) return true;
    return Boolean(settings?.allowOversell);
}

function effectiveLowStockThreshold(product, settings) {
    const per = parseInt(product?.low_stock_threshold, 10);
    if (Number.isFinite(per) && per > 0) return per;
    const global = parseInt(settings?.globalLowStockThreshold, 10);
    return Number.isFinite(global) && global > 0 ? global : DEFAULTS.globalLowStockThreshold;
}

function availableQuantity(product, variantInventory) {
    if (variantInventory != null && variantInventory !== undefined) {
        return parseInt(variantInventory, 10) || 0;
    }
    return parseInt(product?.inventory_quantity, 10) || 0;
}

function isInStock(product, variantInventory) {
    if (!isTracked(product)) return true;
    return availableQuantity(product, variantInventory) > 0;
}

function canPurchase(product, settings, variantInventory) {
    if (!isTracked(product)) return true;
    const qty = availableQuantity(product, variantInventory);
    if (qty > 0) return true;
    return allowsOversell(product, settings);
}

function isLowStock(product, settings, variantInventory) {
    if (!isTracked(product)) return false;
    const qty = availableQuantity(product, variantInventory);
    if (qty <= 0) return false;
    return qty <= effectiveLowStockThreshold(product, settings);
}

function shouldHideFromBrowse(product, settings) {
    if (!settings?.hideOutOfStock) return false;
    if (!isTracked(product)) return false;
    return availableQuantity(product) <= 0;
}

function canFulfillQuantity(product, settings, availableQty, requestedQty) {
    if (!isTracked(product)) return true;
    const qty = parseInt(requestedQty, 10) || 0;
    const avail = parseInt(availableQty, 10) || 0;
    if (qty <= avail) return true;
    return allowsOversell(product, settings);
}

function enrichProductRow(product, settings) {
    const tracked = isTracked(product);
    const threshold = effectiveLowStockThreshold(product, settings);
    const qty = tracked ? availableQuantity(product) : null;
    const inStock = isInStock(product);
    const purchasable = canPurchase(product, settings);
    const low = isLowStock(product, settings);

    product.track_inventory = tracked;
    product.allow_backorder = parseBool(product.allow_backorder);
    product.low_stock_threshold = threshold;
    product.in_stock = inStock;
    product.can_purchase = purchasable;
    product.is_low_stock = low;
    if (tracked) {
        product.inventory_quantity = qty;
    }
    return product;
}

async function loadInventorySettings(pool) {
    const keyNames = Object.values(KEYS);
    const [rows] = await pool.execute(
        `SELECT key_name, value FROM settings WHERE key_name IN (${keyNames.map(() => '?').join(', ')})`,
        keyNames
    );
    const map = new Map((rows || []).map((row) => [row.key_name, row.value]));
    const globalRaw = parseInt(map.get(KEYS.globalLowStockThreshold), 10);
    return {
        globalLowStockThreshold:
            Number.isFinite(globalRaw) && globalRaw >= 0 ? globalRaw : DEFAULTS.globalLowStockThreshold,
        allowOversell: parseBool(map.get(KEYS.allowOversell)),
        hideOutOfStock: parseBool(map.get(KEYS.hideOutOfStock))
    };
}

function toPublicSettings(settings) {
    return {
        globalLowStockThreshold: settings.globalLowStockThreshold,
        allowOversell: settings.allowOversell,
        hideOutOfStock: settings.hideOutOfStock
    };
}

module.exports = {
    KEYS,
    DEFAULTS,
    loadInventorySettings,
    toPublicSettings,
    enrichProductRow,
    shouldHideFromBrowse,
    isTracked,
    allowsOversell,
    effectiveLowStockThreshold,
    isInStock,
    canPurchase,
    isLowStock,
    canFulfillQuantity,
    availableQuantity
};
