'use strict';

const axios = require('axios');
const xml2js = require('xml2js');

function normalizeCode(value) {
    return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function parseVendorAuthCredentials(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function buildCatalogAxiosConfig(vendor) {
    const url = normalizeCode(vendor.catalog_url);
    if (!url) {
        throw Object.assign(new Error('This vendor has no online catalog URL configured in admin'), { code: 'NO_CATALOG_URL' });
    }

    const config = {
        method: 'GET',
        url,
        timeout: 30000,
        headers: {
            Accept: 'application/json, text/csv, application/xml, text/xml, */*'
        },
        responseType: 'text',
        validateStatus: (status) => status >= 200 && status < 300
    };

    const authType = normalizeCode(vendor.catalog_auth_type || 'none').toLowerCase();
    const creds = parseVendorAuthCredentials(vendor.catalog_auth_credentials);
    if (authType !== 'none' && creds) {
        switch (authType) {
            case 'basic':
                config.auth = {
                    username: creds.username || '',
                    password: creds.password || ''
                };
                break;
            case 'bearer':
                if (creds.token) {
                    config.headers.Authorization = `Bearer ${creds.token}`;
                }
                break;
            case 'api_key':
                if (creds.api_key) {
                    const headerName = normalizeCode(creds.header_name) || 'X-API-Key';
                    config.headers[headerName] = creds.api_key;
                }
                break;
            default:
                break;
        }
    }

    return config;
}

async function fetchVendorCatalogText(vendor) {
    const config = buildCatalogAxiosConfig(vendor);
    try {
        const response = await axios(config);
        return {
            text: String(response.data || ''),
            contentType: String(response.headers['content-type'] || '').toLowerCase()
        };
    } catch (err) {
        const status = err?.response?.status;
        if (status) {
            throw Object.assign(new Error(`Could not fetch vendor catalog (${status})`), { code: 'CATALOG_FETCH_FAILED' });
        }
        throw Object.assign(new Error(err.message || 'Could not fetch vendor catalog'), { code: 'CATALOG_FETCH_FAILED' });
    }
}

function parseCatalogCsv(text) {
    const rows = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (rows.length < 2) return [];

    const header = rows[0].split(',').map((h) => h.trim().toLowerCase());
    const idx = (names) => header.findIndex((h) => names.includes(h));
    const skuIdx = idx(['sku', 'product_sku', 'product sku']);
    const vendorSkuIdx = idx(['vendor_sku', 'vendor sku', 'vendor code', 'item', 'code']);
    const nameIdx = idx(['name', 'description', 'product', 'title']);
    const costIdx = idx(['cost', 'unit_cost', 'wholesale', 'price']);
    const moqIdx = idx(['moq', 'minimum_order_quantity', 'min_qty', 'minimum']);

    const items = [];
    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const sku = skuIdx >= 0 ? cols[skuIdx] : null;
        const vendorSku = vendorSkuIdx >= 0 ? cols[vendorSkuIdx] : null;
        const name = nameIdx >= 0 ? cols[nameIdx] : sku || vendorSku;
        if (!sku && !vendorSku && !name) continue;
        items.push({
            sku,
            vendorSku,
            name,
            unitCost: costIdx >= 0 ? toNumber(cols[costIdx], null) : null,
            minimumOrderQuantity: moqIdx >= 0 ? Math.max(1, toNumber(cols[moqIdx], 1)) : 1
        });
    }
    return items;
}

function parseCatalogJson(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return [];
    }
    const list = Array.isArray(data) ? data : data.products || data.items || data.catalog || [];
    return list
        .map((item) => ({
            sku: item.sku || item.product_sku || item.productSku || null,
            vendorSku: item.vendor_sku || item.vendorSku || item.code || null,
            name: item.name || item.description || item.title || '',
            unitCost:
                item.cost != null
                    ? toNumber(item.cost)
                    : item.unit_cost != null
                      ? toNumber(item.unit_cost)
                      : item.price != null
                        ? toNumber(item.price)
                        : null,
            minimumOrderQuantity: Math.max(1, toNumber(item.moq || item.minimum_order_quantity || item.minimumOrderQuantity, 1))
        }))
        .filter((item) => item.name || item.sku || item.vendorSku);
}

function normalizeXmlProducts(xmlData) {
    if (xmlData?.catalog?.product) {
        const products = Array.isArray(xmlData.catalog.product) ? xmlData.catalog.product : [xmlData.catalog.product];
        return products.map((product) => ({
            sku: product.sku?.[0] || product.code?.[0] || null,
            vendorSku: product.vendor_sku?.[0] || product.vendorSku?.[0] || null,
            name: product.name?.[0] || product.description?.[0] || product.title?.[0] || '',
            unitCost: product.cost?.[0] != null ? toNumber(product.cost[0]) : product.price?.[0] != null ? toNumber(product.price[0]) : null,
            minimumOrderQuantity: Math.max(1, toNumber(product.moq?.[0] || product.minimum?.[0], 1))
        }));
    }
    return [];
}

async function parseCatalogXml(text) {
    const parser = new xml2js.Parser();
    const xmlData = await parser.parseStringPromise(text);
    return normalizeXmlProducts(xmlData).filter((item) => item.name || item.sku || item.vendorSku);
}

async function parseVendorCatalogItems(vendor, { text, contentType }) {
    const format = normalizeCode(vendor.catalog_format || 'csv').toLowerCase();
    let items = [];

    if (format === 'json' || format === 'api') {
        items = parseCatalogJson(text);
    } else if (format === 'xml') {
        items = await parseCatalogXml(text);
    } else if (format === 'csv') {
        items = parseCatalogCsv(text);
    } else if (contentType.includes('json') || text.trim().startsWith('[') || text.trim().startsWith('{')) {
        items = parseCatalogJson(text);
    } else if (contentType.includes('xml') || text.trim().startsWith('<?xml') || text.trim().startsWith('<')) {
        items = await parseCatalogXml(text);
    } else {
        items = parseCatalogCsv(text);
    }

    return items;
}

async function fetchAndParseVendorCatalog(vendor) {
    const payload = await fetchVendorCatalogText(vendor);
    const items = await parseVendorCatalogItems(vendor, payload);
    if (!items.length) {
        throw Object.assign(new Error('Vendor catalog URL returned no recognizable products'), { code: 'EMPTY_CATALOG' });
    }
    return items;
}

module.exports = {
    parseVendorAuthCredentials,
    buildCatalogAxiosConfig,
    fetchVendorCatalogText,
    fetchAndParseVendorCatalog,
    parseCatalogCsv,
    parseCatalogJson,
    parseVendorCatalogItems
};
