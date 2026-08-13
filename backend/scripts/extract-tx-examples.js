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
            const examples = spec.paths['/api/transaction']?.post?.requestBody?.content?.['application/json']?.examples || {};
            for (const name of [
                'Sale Using Token - MOTO',
                'Sale - (Do Not Pass Receipts In Response - Ecommerce)',
                'Pre-Auth Only With Token (MOTO - Pass Receipts In Response)'
            ]) {
                if (examples[name]) {
                    console.log('\n===', name, '===');
                    console.log(JSON.stringify(examples[name].value, null, 2));
                }
            }
            break;
        }
    }
}
