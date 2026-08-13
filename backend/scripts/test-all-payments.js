#!/usr/bin/env node
'use strict';

/**
 * Run the full payment + gift card test battery.
 * Usage: node scripts/test-all-payments.js [--base http://127.0.0.1:3001] [--headful]
 */

const { spawnSync } = require('child_process');
const path = require('path');

const backendDir = path.join(__dirname, '..');
const extraArgs = process.argv.slice(2);
const baseIdx = extraArgs.indexOf('--base');
const base =
    baseIdx >= 0 && extraArgs[baseIdx + 1]
        ? extraArgs[baseIdx + 1]
        : 'http://127.0.0.1:3001';

const suites = [
    { name: 'Jest (nmiGateway)', cmd: 'npm', args: ['test', '--', '--testPathPattern=nmiGateway', '--silent'] },
    { name: 'Smoke features', cmd: 'node', args: ['scripts/smoke-features.js', '--base', base] },
    { name: 'NMI connectivity', cmd: 'node', args: ['scripts/test-nmi-connectivity.js'] },
    { name: 'Gift card API', cmd: 'node', args: ['scripts/test-gift-card-flow.js', '--base', base] },
    { name: 'Gift card UI', cmd: 'node', args: ['scripts/test-gift-card-ui.js', '--base', base, ...extraArgs.filter((a, i) => a !== '--base' && i !== baseIdx + 1)] },
    { name: 'Cash + CC payments', cmd: 'node', args: ['scripts/test-cash-cc-payments.js', '--base', base, ...extraArgs.filter((a, i) => a !== '--base' && i !== baseIdx + 1)] },
];

console.log(`\n${'='.repeat(60)}`);
console.log('HM Herbs — full payment test battery');
console.log(`Base: ${base}`);
console.log(`${'='.repeat(60)}\n`);

let failed = 0;
for (const suite of suites) {
    console.log(`\n>>> ${suite.name}\n`);
    const result = spawnSync(suite.cmd, suite.args, {
        cwd: backendDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: process.env,
    });
    if (result.status !== 0) {
        console.error(`\n*** FAILED: ${suite.name} (exit ${result.status ?? 'signal'}) ***\n`);
        failed += 1;
    } else {
        console.log(`\n*** PASSED: ${suite.name} ***\n`);
    }
}

console.log(`\n${'='.repeat(60)}`);
if (failed) {
    console.log(`FAILED: ${failed} of ${suites.length} suites`);
    process.exit(1);
}
console.log(`ALL ${suites.length} SUITES PASSED`);
console.log(`${'='.repeat(60)}\n`);
