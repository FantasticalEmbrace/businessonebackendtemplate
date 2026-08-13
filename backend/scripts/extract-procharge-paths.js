'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../tmp-procharge-help.html'), 'utf8');
const start = html.indexOf('"spec":');
if (start < 0) throw new Error('spec not found');
let depth = 0;
let inStr = false;
let esc = false;
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
            console.log('API version:', spec.info?.version);
            for (const p of Object.keys(spec.paths || {}).sort()) {
                const methods = Object.keys(spec.paths[p]).join(',');
                console.log(`${methods.toUpperCase()} ${p}`);
            }
            break;
        }
    }
}
