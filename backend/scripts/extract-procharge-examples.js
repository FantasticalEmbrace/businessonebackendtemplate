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
            const examples = spec.paths['/api/transaction']?.post?.requestBody?.content?.['application/json']?.examples || {};
            for (const name of Object.keys(examples).sort()) {
                if (/ecommerce|token|invoice|validate/i.test(name)) {
                    console.log('\n=== ' + name + ' ===');
                    console.log(JSON.stringify(examples[name].value, null, 2));
                }
            }
            const invGet = spec.paths['/api/gateway/invoice/{invoiceid}']?.get;
            console.log('\n=== INVOICE GET RESPONSE SCHEMA ===');
            console.log(JSON.stringify(invGet?.responses?.['200']?.content?.['application/json']?.schema, null, 2).slice(0, 6000));
            const invPost = spec.paths['/api/gateway/invoice']?.post?.responses?.['200'];
            console.log('\n=== INVOICE POST RESPONSE ===');
            console.log(JSON.stringify(invPost, null, 2));
            break;
        }
    }
}
