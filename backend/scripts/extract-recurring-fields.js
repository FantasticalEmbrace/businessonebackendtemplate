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
            const hits = [];
            function walk(obj, ctx) {
                if (obj == null || typeof obj !== 'object') return;
                if (Array.isArray(obj)) return obj.forEach((v, j) => walk(v, `${ctx}[${j}]`));
                for (const [k, v] of Object.entries(obj)) {
                    const blob = k + (typeof v === 'string' ? v : JSON.stringify(v).slice(0, 500));
                    if (/recurr|auto.?bill|installment|subscription|monthly|card.?on.?file|cof/i.test(blob)) {
                        hits.push({ ctx: `${ctx}.${k}`, value: typeof v === 'string' ? v : v });
                    }
                    walk(v, `${ctx}.${k}`);
                }
            }
            walk(spec.paths['/api/gateway/invoice'], 'invoice');
            walk(spec.components?.schemas?.transaction, 'transaction');
            walk(spec.paths['/api/token'], 'token');
            for (const h of hits) {
                console.log('\n---', h.ctx, '---');
                console.log(typeof h.value === 'string' ? h.value.slice(0, 600) : JSON.stringify(h.value, null, 2).slice(0, 800));
            }
            break;
        }
    }
}
