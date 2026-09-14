'use strict';

/**
 * AI-assisted column mapping for the bulk product CSV import.
 *
 * Different POS/catalog systems export their product data with completely
 * different column names and layouts (see ProductImporter.FIELD_ALIASES for
 * the ones already known). This service is the next layer up: before any
 * row gets turned into a product, figure out what each COLUMN in the file
 * actually means.
 *
 * Two passes, cheapest first:
 *   1. Deterministic — reuse the exact same alias list ProductImporter uses,
 *      just applied to headers instead of row values. Free, instant, and
 *      covers the common case (headers we've already seen before).
 *   2. AI (only for headers the deterministic pass couldn't place) — shown
 *      the header text plus a few real example values, asked to pick one of
 *      a FIXED set of target fields (or "ignore"). The model never invents
 *      data or touches the file; it only proposes a mapping the merchant
 *      reviews before anything is imported.
 *
 * If every header is confidently placed by pass 1, AI is never called and
 * the merchant never sees an extra screen — mirroring the same
 * "don't be annoying" design as productImportReview.js.
 */

const axios = require('axios');
const logger = require('../utils/logger');
const ProductImporter = require('../scripts/import-products');

const { findFieldForHeader } = ProductImporter;

const AI_TIMEOUT_MS = 20000;

/** Fields worth confirming with the merchant. Keys match FIELD_ALIASES / mapCSVToProduct exactly. */
const CANONICAL_FIELDS = Object.freeze([
    { key: 'name', label: 'Product name', description: 'The product title/name shown to customers.' },
    { key: 'sku', label: 'SKU / barcode', description: 'SKU, UPC, EAN, or other product identifier/barcode.' },
    { key: 'price', label: 'Retail price', description: 'The price customers pay (sell price) — NOT cost.' },
    { key: 'cost_price', label: 'Cost price', description: 'What the merchant pays their supplier (wholesale cost) — NOT the retail price.' },
    { key: 'compare_price', label: 'Compare-at / MSRP', description: 'A "was" price or manufacturer suggested retail price, shown crossed out.' },
    { key: 'quantity', label: 'Quantity on hand', description: 'Current stock/inventory count.' },
    { key: 'brand', label: 'Brand / manufacturer', description: 'The brand or manufacturer name.' },
    { key: 'category', label: 'Category', description: 'Product category or department.' },
    { key: 'description', label: 'Description', description: 'Product description text.' },
    { key: 'image_url', label: 'Image URL', description: 'A URL pointing to a product photo.' }
]);

const CANONICAL_KEYS = new Set(CANONICAL_FIELDS.map((f) => f.key));

/**
 * Pass 1: exact reuse of ProductImporter's own alias knowledge.
 *
 * ProductImporter treats "sku" and "barcode" as two separate alias groups
 * (checking sku first, then falling back to barcode) but they both feed the
 * same unified `sku` canonical field here — a file with only a "UPC" column
 * and no "SKU" column must still count as having the identifier mapped.
 */
function detectDeterministicMapping(headers) {
    const raw = headers.map((header) => ({ header, rawField: findFieldForHeader(header) }));
    // Preserve ProductImporter's own precedence: an explicit sku-alias header
    // wins over a barcode-alias header when a file happens to have both.
    const ordered = [
        ...raw.filter((r) => r.rawField === 'sku'),
        ...raw.filter((r) => r.rawField === 'barcode'),
        ...raw.filter((r) => r.rawField && r.rawField !== 'sku' && r.rawField !== 'barcode')
    ];

    const mapping = [];
    const usedFields = new Set();
    for (const { header, rawField } of ordered) {
        const field = rawField === 'barcode' ? 'sku' : rawField;
        if (field && CANONICAL_KEYS.has(field) && !usedFields.has(field)) {
            mapping.push({ header, field, confidence: 'high', source: 'deterministic', reason: 'Matches a known header for this field.' });
            usedFields.add(field);
        }
    }
    return mapping;
}

function sampleValuesFor(header, sampleRows, max = 3) {
    return sampleRows
        .map((row) => row?.[header])
        .filter((v) => v != null && String(v).trim() !== '')
        .slice(0, max)
        .map((v) => String(v).trim().slice(0, 60));
}

/** Pass 2: AI guess, only for headers pass 1 couldn't place. Fails safe (returns null) on any error. */
async function suggestMappingWithAi(unmappedHeaders, sampleRows, alreadyUsedFields) {
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey || !unmappedHeaders.length) return null;

    const remainingFields = CANONICAL_FIELDS.filter((f) => !alreadyUsedFields.has(f.key));
    if (!remainingFields.length) return null;

    const baseUrl = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const columnSamples = unmappedHeaders.map((header) => ({
        header,
        sampleValues: sampleValuesFor(header, sampleRows)
    }));

    const systemPrompt = `You map spreadsheet columns from a point-of-sale/catalog export to a fixed set of product fields. Different POS systems name and order columns differently — match by MEANING using the header text and example values, never by position.

Only choose from these target fields:
${remainingFields.map((f) => `- ${f.key}: ${f.label} — ${f.description}`).join('\n')}
- ignore: this column doesn't map to any of the above (e.g. internal IDs, timestamps, vendor notes, location codes)

Rules:
- "cost_price" is what the MERCHANT pays a supplier. "price" is what a CUSTOMER pays. Never swap these.
- If a column could plausibly be more than one target field, choose "ignore" with confidence "low" and let a human decide — do not guess on ambiguous columns.
- Each target field should be used at most once; if two columns seem to fit the same field, only map the better match and set the other to "ignore".
- Respond with JSON only, no markdown: {"mapping": [{"header": "...", "field": "<one of the keys above or ignore>", "confidence": "high"|"medium"|"low", "reason": "short reason, under 15 words"}]}
- Include exactly one entry per header listed, in the same order given.`;

    const userPrompt = `Unmapped columns with real example values from the file:\n${JSON.stringify(columnSamples, null, 2)}`;

    try {
        const { data } = await axios.post(`${baseUrl}/chat/completions`, {
            model,
            temperature: 0.1,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            response_format: { type: 'json_object' }
        }, {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: AI_TIMEOUT_MS
        });

        const content = data?.choices?.[0]?.message?.content;
        const parsed = JSON.parse(content || '{}');
        if (!Array.isArray(parsed.mapping)) return null;

        const allowedFields = new Set([...remainingFields.map((f) => f.key), 'ignore']);
        const headerSet = new Set(unmappedHeaders);
        const seenFields = new Set();
        const out = [];
        for (const m of parsed.mapping) {
            if (!m || !headerSet.has(m.header) || !allowedFields.has(m.field)) continue;
            if (m.field !== 'ignore' && seenFields.has(m.field)) continue; // no double-claiming a field
            if (m.field !== 'ignore') seenFields.add(m.field);
            out.push({
                header: m.header,
                field: m.field,
                confidence: ['high', 'medium', 'low'].includes(m.confidence) ? m.confidence : 'medium',
                reason: String(m.reason || '').trim().slice(0, 160),
                source: 'ai'
            });
        }
        return out;
    } catch (err) {
        logger.error('Column mapping AI error:', err.response?.data?.error?.message || err.message);
        return null; // never block the import over an AI failure
    }
}

/**
 * @param {string[]} headers
 * @param {Array<object>} sampleRows - a handful of raw rows keyed by original header
 * @param {{ useAi?: boolean }} [opts]
 */
async function proposeColumnMapping(headers, sampleRows, opts = {}) {
    const useAi = opts.useAi !== false;
    const cleanHeaders = (headers || []).filter((h) => h != null && String(h).trim() !== '');

    const deterministic = detectDeterministicMapping(cleanHeaders);
    const mappedHeaders = new Set(deterministic.map((m) => m.header));
    const usedFields = new Set(deterministic.map((m) => m.field));
    const unmappedHeaders = cleanHeaders.filter((h) => !mappedHeaders.has(h));

    let aiMapping = [];
    let aiUsed = false;
    if (useAi && unmappedHeaders.length) {
        const aiResult = await suggestMappingWithAi(unmappedHeaders, sampleRows || [], usedFields);
        if (Array.isArray(aiResult) && aiResult.length) {
            aiMapping = aiResult;
            aiUsed = true;
        }
    }

    const mapping = [...deterministic, ...aiMapping];
    const mappingByHeader = new Map(mapping.map((m) => [m.header, m]));
    const stillUnmapped = cleanHeaders.filter((h) => !mappingByHeader.has(h));

    const mappedFieldKeys = new Set(mapping.filter((m) => m.field !== 'ignore').map((m) => m.field));
    const coreFieldsMissing = ['name', 'sku', 'price'].filter((f) => !mappedFieldKeys.has(f));
    const hasLowConfidence = mapping.some((m) => m.confidence === 'low');

    // Only interrupt the merchant when there's real uncertainty — AI had to
    // guess, a core field is still unplaced, or a mapping came back low
    // confidence. Otherwise the deterministic pass alone is trusted and the
    // import proceeds straight through, same as before this feature existed.
    const needsReview = aiUsed || coreFieldsMissing.length > 0 || hasLowConfidence;

    const columnMapping = {};
    mapping.forEach((m) => {
        if (m.field && m.field !== 'ignore') columnMapping[m.header] = m.field;
    });

    return {
        mapping,
        unmappedHeaders: stillUnmapped,
        columnMapping,
        coreFieldsMissing,
        aiUsed,
        needsReview
    };
}

module.exports = {
    proposeColumnMapping,
    detectDeterministicMapping,
    suggestMappingWithAi,
    CANONICAL_FIELDS
};
