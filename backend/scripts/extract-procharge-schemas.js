'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../tmp-procharge-help.html'), 'utf8');
const start = html.indexOf('"spec":');
let depth = 0, inStr = false, esc = false;
let i = html.indexOf('{', start);
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
            const paths = ['/api/gateway/invoice', '/api/token', '/api/transaction', '/api/authentication/login'];
            for (const p of paths) {
                console.log('\n===', p, '===');
                console.log(JSON.stringify(spec.paths[p], null, 2).slice(0, 8000));
            }
            const schemas = ['transaction', 'tokenRequest', 'tokenResponse', 'invoiceRequest', 'invoice'];
            for (const s of schemas) {
                if (spec.components?.schemas?.[s]) {
                    console.log('\n=== schema:', s, '===');
                    console.log(JSON.stringify(spec.components.schemas[s], null, 2).slice(0, 6000));
                }
            }
            const t = spec.components?.schemas?.transaction?.properties || {};
            for (const k of ['token', 'source', 'isProcharge', 'industryType', 'cardNumber', 'paymentGatewayID']) {
                if (t[k]) {
                    console.log('\n=== transaction.' + k, '===');
                    console.log(JSON.stringify(t[k], null, 2));
                }
            }
            console.log('\n=== GET /api/gateway/invoice/{invoiceid} ===');
            console.log(JSON.stringify(spec.paths['/api/gateway/invoice/{invoiceid}'], null, 2).slice(0, 5000));
            break;
        }
    }
}
