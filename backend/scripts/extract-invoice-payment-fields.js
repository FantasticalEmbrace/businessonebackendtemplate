'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../tmp-procharge-help-live.html'), 'utf8');
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
            const props =
                spec.paths['/api/gateway/invoice/{invoiceid}']?.get?.responses?.['200']?.content?.[
                    'application/json'
                ]?.schema?.properties || {};
            console.log('Invoice GET fields with payment relevance:');
            for (const [k, v] of Object.entries(props)) {
                if (/url|link|pay|status|host|gateway|num|id|email|amount|due/i.test(k)) {
                    console.log(`  ${k}: ${v.description || ''} (example: ${v.example ?? 'n/a'})`);
                }
            }
            break;
        }
    }
}
