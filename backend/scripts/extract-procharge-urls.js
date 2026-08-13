'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../tmp-procharge-help.html'), 'utf8');
const urls = [...html.matchAll(/https?:\/\/[^"'\\s<>]+/g)].map((m) => m[0].replace(/\\/g, ''));
const unique = [...new Set(urls)].sort();
console.log('URL count:', unique.length);
unique.forEach((u) => console.log(u));
