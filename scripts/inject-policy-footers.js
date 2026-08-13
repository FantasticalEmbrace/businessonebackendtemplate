#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '..');
const pp = fs.readFileSync(path.join(repo, 'privacy-policy.html'), 'utf8');
const m = pp.match(/    <!-- Footer -->[\s\S]*?    <\/footer>/);
if (!m) throw new Error('footer not found');
const footer = m[0];
const scripts = [
  '    <!-- Scripts -->',
  '    <script src="js/age-gate.js" defer></script>',
  '    <script src="js/site-promo-banner.js" defer></script>',
  '    <script src="js/site-store-info.js" defer></script>',
  '    <script src="js/visual-bug-fixes.js"></script>',
  '    <script src="script.js" defer></script>',
  '    <script src="gdpr-compliance.js?v=20260617a" defer></script>'
].join('\n');

for (const f of ['terms-and-conditions.html', 'coa.html']) {
  const p = path.join(repo, f);
  let c = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  c = c.replace(/\n    <!-- Footer injected[\s\S]*?<\/body>/, '\n' + footer + '\n\n' + scripts + '\n</body>');
  c = c.replace(/\n    <script src="js\/age-gate\.js"[\s\S]*?<\/body>/, '\n' + footer + '\n\n' + scripts + '\n</body>');
  fs.writeFileSync(p, c.replace(/\n/g, '\r\n'), 'utf8');
  console.log('OK', f, c.includes('footer-compliance-disclaimers'));
}
