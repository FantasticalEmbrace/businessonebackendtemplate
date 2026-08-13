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
            const getInv = spec.paths['/api/gateway/invoice/{invoiceid}']?.get;
            const props = getInv?.responses?.['200']?.content?.['application/json']?.schema?.properties || {};
            console.log('Invoice GET fields:', Object.keys(props).sort().join(', '));
            for (const k of Object.keys(props).sort()) {
                if (/url|link|pay|host|gateway/i.test(k)) {
                    console.log(k + ':', JSON.stringify(props[k]));
                }
            }
            const txExamples = spec.paths['/api/transaction']?.post?.requestBody?.content?.['application/json']?.examples;
            if (txExamples) console.log('transaction examples:', Object.keys(txExamples));
            break;
        }
    }
}
