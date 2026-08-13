'use strict';
const fs = require('fs');
const path = require('path');

const apiHtml = fs.readFileSync(path.join(__dirname, '../tmp-procharge-help-live.html'), 'utf8');
let depth = 0, inStr = false, esc = false;
let i = apiHtml.indexOf('{', apiHtml.indexOf('"spec":'));
const begin = i;
let spec;
for (; i < apiHtml.length; i++) {
    const c = apiHtml[i];
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
            spec = JSON.parse(apiHtml.slice(begin, i + 1));
            break;
        }
    }
}

const apiBlob = JSON.stringify(spec).toLowerCase();
console.log('=== API SPEC (api.procharge.com/api/help v' + (spec.info?.version || '?') + ') ===');
console.log('Custom Checkout mentioned:', /custom checkout/.test(apiBlob) ? 'YES' : 'NO');
console.log('checkout page mentioned:', /checkout page/.test(apiBlob) ? 'YES' : 'NO');
console.log('donate mentioned:', /donate/.test(apiBlob) ? 'YES' : 'NO');
console.log('');
console.log('Recurring-related in API:');
for (const term of [
    'recurring bill',
    'autobill',
    'auto bill',
    'invoicemode',
    'isrecurring',
    'recurring transaction',
    'card on file',
    'cof'
]) {
    console.log('  ' + term + ':', apiBlob.includes(term.replace(/\s/g, '')) || apiBlob.includes(term) ? 'YES' : 'NO');
}

console.log('\nAPI paths containing invoice or checkout:');
for (const p of Object.keys(spec.paths || {}).sort()) {
    if (/invoice|checkout/i.test(p)) console.log('  ' + p);
}

const guidePath = path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/empty-window/agent-tools/06c92572-3aa0-4378-8114-467f7fdc08e7.txt'
);
if (fs.existsSync(guidePath)) {
    const guide = fs.readFileSync(guidePath, 'utf8');
    console.log('\n=== GATEWAY USER GUIDE (PDF text) ===');
    const ccStart = guide.indexOf('### Custom Checkout');
    const ccEnd = guide.indexOf('### QBO Sync', ccStart);
    const ccSection = ccStart >= 0 ? guide.slice(ccStart, ccEnd) : '';
    console.log('Custom Checkout section:\n' + ccSection.trim());
    console.log('\nRecurring mentions near Custom Checkout:', /recurr/i.test(ccSection) ? 'YES' : 'NO');

    const invStart = guide.indexOf('### Creating Invoices');
    const invEnd = guide.indexOf('### Processing Invoice Payments', invStart);
    const invSection = invStart >= 0 ? guide.slice(invStart, invEnd + 800) : '';
    console.log('\nInvoice recurring (excerpt):');
    const lines = invSection.split('\n').filter((l) => /recurr|auto bill/i.test(l));
    lines.forEach((l) => console.log('  ' + l.trim()));
}
