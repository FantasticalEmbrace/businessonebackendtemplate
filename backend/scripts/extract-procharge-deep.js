'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../tmp-procharge-help.html'), 'utf8');
let depth = 0, inStr = false, esc = false;
let i = html.indexOf('{', html.indexOf('"spec":'));
const begin = i;
for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
        depth--;
        if (depth === 0) {
            const spec = JSON.parse(html.slice(begin, i + 1));
            const urls = new Set();
            function walk(obj, ctx = '') {
                if (obj == null) return;
                if (typeof obj === 'string') {
                    for (const m of obj.matchAll(/https?:\/\/[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g)) {
                        urls.add(m[0]);
                    }
                    return;
                }
                if (Array.isArray(obj)) obj.forEach((v) => walk(v, ctx));
                else if (typeof obj === 'object') {
                    for (const [k, v] of Object.entries(obj)) walk(v, ctx ? `${ctx}.${k}` : k);
                }
            }
            walk(spec);
            console.log('Found', urls.size, 'URLs in OpenAPI spec:\n');
            [...urls].sort().forEach((u) => console.log(u));

            console.log('\n=== TAG DESCRIPTIONS (HTML) ===');
            for (const tag of spec.tags || []) {
                console.log('\n---', tag.name, '---');
                const text = (tag.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                console.log(text.slice(0, 2000));
            }

            console.log('\n=== TRANSACTION FIELD: token ===');
            const txProps = spec.components?.schemas?.transaction?.properties || {};
            for (const k of ['token', 'cardNumber', 'profileID', 'isProcharge']) {
                if (txProps[k]) console.log(k + ':', JSON.stringify(txProps[k], null, 2));
            }

            console.log('\n=== ALL ENDPOINT SUMMARIES ===');
            for (const [p, methods] of Object.entries(spec.paths || {}).sort()) {
                for (const [m, op] of Object.entries(methods)) {
                    if (op.summary) console.log(m.toUpperCase(), p, '-', op.summary);
                }
            }
            break;
        }
    }
}
