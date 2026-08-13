/**
 * Parse hmherbs.com storefront product option groups from HTML.
 */
const cheerio = require('cheerio');
const {
    indexVariationDataBySku,
    matchVariationImageForOption,
} = require('./extractHmherbsVariationData');

function parsePriceFromLabel(text) {
    const s = String(text);
    const sale = s.match(/=\s*\$\s*([\d,.]+)\s*$/);
    if (sale) {
        const n = parseFloat(sale[1].replace(/,/g, ''));
        if (Number.isFinite(n)) return n;
    }
    const patterns = [/\s*-\s*\$\s*([\d,.]+)\s*$/, /-\$\s*([\d,.]+)\s*$/, /\$\s*([\d,.]+)\s*$/];
    for (const re of patterns) {
        const m = s.match(re);
        if (m) {
            const n = parseFloat(m[1].replace(/,/g, ''));
            if (Number.isFinite(n)) return n;
        }
    }
    return null;
}

function parseSkuHint(text) {
    const m = String(text).match(/#([A-Za-z0-9-]+)/);
    return m ? m[1] : null;
}

function labelWithoutPrice(text) {
    return String(text)
        .replace(/\s*=\s*\$\s*[\d,.]+\s*$/i, '')
        .replace(/\s*-\s*\$\s*[\d,.]+\s*$/i, '')
        .replace(/-\$\s*[\d,.]+\s*$/i, '')
        .replace(/\s*\$\s*[\d,.]+\s*$/i, '')
        .trim();
}

/**
 * Try to split a flat option label into matrix attributes (Size, Form, Pack).
 * e.g. "#0784 - 4oz Tube - $25.49" -> { Size: "4oz", Form: "Tube" }
 */
function inferAttributesFromLabel(label) {
    const base = labelWithoutPrice(label);
    const attrs = {};

    const ozMatch = base.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
    if (ozMatch) attrs.Size = `${ozMatch[1]}oz`;

    const capsMatch = base.match(/(\d+)\s*caps(?:ules?)?\b/i);
    if (capsMatch) attrs.Count = `${capsMatch[1]} Caps`;

    const tabletsMatch = base.match(/(\d+)\s*tablets?\b/i);
    if (tabletsMatch) attrs.Count = `${tabletsMatch[1]} Tablets`;

    const packMatch = base.match(/(\d+)\s*pack\b/i);
    if (packMatch) attrs.Pack = `${packMatch[1]} Pack`;

    const tubesMatch = base.match(/^(\d+)\s*-\s*tubes?\b/i);
    if (tubesMatch) attrs.Pack = `${tubesMatch[1]} Tube${tubesMatch[1] === '1' ? '' : 's'}`;

    if (/\btube\b/i.test(base) && !attrs.Form) attrs.Form = 'Tube';
    if (/\bjar\b/i.test(base) && !attrs.Form) attrs.Form = 'Jar';
    if (/black pepper/i.test(base) && !attrs.Formulation) attrs.Formulation = 'With Black Pepper';

    return Object.keys(attrs).length ? attrs : null;
}

function extractHmherbsVariantsFromHtml(html) {
    const $ = cheerio.load(html);
    const variationIndex = indexVariationDataBySku(html);
    const groups = [];

    $('.store-product-option-group').each((_, groupEl) => {
        const $group = $(groupEl);
        const groupName =
            $group.find('.store-product-option-group-label').first().text().trim() ||
            'Options';
        const options = [];

        $group.find('select.store-product-option option').each((__, optEl) => {
            const text = $(optEl).text().trim();
            if (!text) return;
            const price = parsePriceFromLabel(text);
            const value = $(optEl).attr('value') || '';
            const label = labelWithoutPrice(text) || text;
            const skuHint = parseSkuHint(text);
            const inferred = inferAttributesFromLabel(text);
            const attributes = inferred || { [groupName]: label };

            options.push({
                externalValue: value,
                name: text,
                label,
                price,
                skuHint,
                attributes,
                image_url: matchVariationImageForOption(
                    { externalValue: value, skuHint },
                    variationIndex
                ),
            });
        });

        if (options.length) {
            const values = [...new Set(options.map((o) => o.label))];
            groups.push({ name: groupName, values, options });
        }
    });

    if (!groups.length) {
        return { variant_option_groups: [], variants: [] };
    }

    const variant_option_groups = groups.map((g) => ({
        name: g.name,
        values: g.values,
    }));

    // Single group: one variant per option
    if (groups.length === 1) {
        const g = groups[0];
        const variants = g.options.map((opt, idx) => ({
            name: opt.label || opt.name,
            label: opt.label,
            price: opt.price,
            skuHint: opt.skuHint,
            externalValue: opt.externalValue,
            attributes: opt.attributes,
            image_url: opt.image_url || null,
            sort_order: idx,
        }));
        return { variant_option_groups, variants };
    }

    // Multiple groups on hmherbs are rare; flatten combinations from each select (usually one row each)
    const variants = [];
    let sort = 0;
    for (const g of groups) {
        for (const opt of g.options) {
            variants.push({
                name: opt.label || opt.name,
                label: opt.label,
                price: opt.price,
                skuHint: opt.skuHint,
                externalValue: opt.externalValue,
                attributes: opt.attributes,
                image_url: opt.image_url || null,
                sort_order: sort++,
            });
        }
    }

    return { variant_option_groups, variants };
}

module.exports = {
    extractHmherbsVariantsFromHtml,
    parsePriceFromLabel,
    labelWithoutPrice,
    inferAttributesFromLabel,
};
