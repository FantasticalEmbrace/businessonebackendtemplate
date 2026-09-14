#!/usr/bin/env node
/**
 * Fix common UTF-8 mojibake in admin.html / admin-app.js (â€" → —, etc.)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['admin.html', 'admin-app.js'];

const REPLACEMENTS = [
  ['â€"', '—'],
  ['â€¦', '…'],
  ['â€™', "'"],
  ['â€œ', '"'],
  ['â€\u009d', '"'],
  ['Â·', '·'],
  ['Ã¢â‚¬â€œ', '—'],
  ['Ã¢â€ â€™', '→'],
  ['Ã¢â€°Â¥', '≥'],
  ['\u00c3\u00a2\u00e2\u20ac\u00a0\'', '→'],
  ['Ã¢Å"â€¦', '✅'],
  ['Ã°Å¸â€™Â¡', '💡'],
  ['Ã°Å¸â€œÂ¦', '📦'],
  ['Ã°Å¸â€Â', '🔍'],
  ['Ã°Å¸â€â€ž', '🔄'],
  ['Ã°Å¸â€œÂ¥', '📥'],
  ['Ã°Å¸â€œâ€¹', '📋'],
  ['Ã°Å¸â€œÅ', '📊'],
  ['Ã°Å¸â€œÂ', '📝'],
  ['â€¢â€¢â€¢â€¢', '••••'],
  ['â€"', '—'],
];

for (const file of FILES) {
  const fp = path.join(ROOT, file);
  let text = fs.readFileSync(fp, 'utf8');
  let changed = 0;
  for (const [bad, good] of REPLACEMENTS) {
    const parts = text.split(bad);
    if (parts.length > 1) {
      changed += parts.length - 1;
      text = parts.join(good);
    }
  }
  if (changed > 0) {
    fs.writeFileSync(fp, text, 'utf8');
    console.log(`${file}: fixed ${changed} mojibake sequence(s)`);
  } else {
    console.log(`${file}: no changes`);
  }
}
