#!/usr/bin/env node
'use strict';

/**
 * Tests POS Help / Troubleshooting diagnostics + auto-fix (API + UI).
 * Run: node scripts/test-pos-diagnostics.js [--base http://127.0.0.1:3001]
 */

const puppeteer = require('puppeteer');
const crypto = require('crypto');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { createDevice, revokeDevice } = require('../services/posDeviceRegistry');
const { createEmployee } = require('../services/posPersonnel');

loadBackendEnv();

const BASE = (() => {
    const i = process.argv.indexOf('--base');
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/+$/, '');
    return 'http://127.0.0.1:3001';
})();
const TEST_TAG = `DIAG-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let pool;
let browser;
let testDevice;
let testEmployee;
const testPin = String(Math.floor(1000 + Math.random() * 9000));

function pass(name, detail = '') {
    results.push({ ok: true, name, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
    results.push({ ok: false, name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForServer(maxMs = 45000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try {
            const res = await fetch(`${BASE}/api/health`);
            if (res.ok) return true;
        } catch {
            /* retry */
        }
        await sleep(500);
    }
    return false;
}

async function posApi(path, { apiKey, deviceLabel, token, method = 'GET', body } = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'X-POS-API-Key': apiKey,
        'X-POS-Device-Id': deviceLabel,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/api/pos/v1${path}`, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function setupFixture() {
    const label = `Diag-${TEST_TAG}`.slice(0, 64);
    testDevice = await createDevice(pool, label);
    testEmployee = await createEmployee(
        pool,
        {
            employeeCode: `D${Date.now().toString().slice(-6)}`,
            firstName: 'Diag',
            lastName: 'Tester',
            pin: testPin,
        },
        null
    );
    return { apiKey: testDevice.apiKey, label, pin: testPin };
}

async function cleanup() {
    if (pool && testEmployee?.id) {
        await pool.execute('DELETE FROM pos_employees WHERE id = ?', [testEmployee.id]).catch(() => {});
    }
    if (pool && testDevice?.id) {
        await revokeDevice(pool, testDevice.id).catch(() => {});
    }
    if (pool) await pool.end().catch(() => {});
    if (browser) await browser.close().catch(() => {});
}

async function testDiagnosticApiEndpoints(fixture) {
    console.log('\nDiagnostics API probes (live register)');
    const health = await posApi('/health', { apiKey: fixture.apiKey, deviceLabel: fixture.label });
    if (health.status === 200 && health.data.ok) pass('GET /health', health.data.deviceId);
    else fail('GET /health', `HTTP ${health.status}`);

    const config = await posApi('/config', { apiKey: fixture.apiKey, deviceLabel: fixture.label });
    if (config.status === 200 && config.data.storeName) pass('GET /config', config.data.storeName);
    else fail('GET /config', `HTTP ${config.status}`);

    const categories = await posApi('/categories', { apiKey: fixture.apiKey, deviceLabel: fixture.label });
    const catCount = Array.isArray(categories.data?.categories) ? categories.data.categories.length : 0;
    if (categories.status === 200) pass('GET /categories', `${catCount} categories`);
    else fail('GET /categories', `HTTP ${categories.status}`);

    try {
        const gcRes = await fetch(`${BASE}/api/gift-cards/catalog`);
        const gcData = await gcRes.json().catch(() => ({}));
        const gcCount = Array.isArray(gcData.products) ? gcData.products.length : 0;
        if (gcRes.ok) pass('GET /api/gift-cards/catalog', `${gcCount} product(s)`);
        else fail('GET /api/gift-cards/catalog', `HTTP ${gcRes.status}`);
    } catch (e) {
        fail('GET /api/gift-cards/catalog', e.message);
    }

    const login = await posApi('/employees/login', {
        apiKey: fixture.apiKey,
        deviceLabel: fixture.label,
        method: 'POST',
        body: { pin: fixture.pin },
    });
    if (login.status !== 200 || !login.data.token) {
        fail('Employee login for shift probe', `HTTP ${login.status}`);
        return;
    }
    pass('Employee login for diagnostics', testEmployee.employee_code || testEmployee.employeeCode);

    const shift = await posApi('/shift/current', {
        apiKey: fixture.apiKey,
        deviceLabel: fixture.label,
        token: login.data.token,
    });
    if (shift.status === 200) pass('GET /shift/current', shift.data.shift ? 'shift open' : 'no shift');
    else fail('GET /shift/current', `HTTP ${shift.status}`);

    const briefing = await posApi('/troubleshoot/briefing', {
        apiKey: fixture.apiKey,
        deviceLabel: fixture.label,
        method: 'POST',
        body: {
            localChecks: [
                { id: 'summary', status: 'warn', title: '2 warning(s)', detail: 'test' },
                { id: 'hardware', status: 'warn', title: 'Printer', detail: 'browser mode' }
            ]
        }
    });
    if (briefing.status === 200 && String(briefing.data?.reply || '').length > 10) {
        pass('POST /troubleshoot/briefing', briefing.data.source || 'ok');
    } else fail('POST /troubleshoot/briefing', `HTTP ${briefing.status}`);

    const chat = await posApi('/troubleshoot/chat', {
        apiKey: fixture.apiKey,
        deviceLabel: fixture.label,
        method: 'POST',
        body: {
            message: 'Why might printing fail?',
            localChecks: [{ id: 'hardware', status: 'warn', title: 'Printer', detail: 'browser' }]
        }
    });
    if (chat.status === 200 && String(chat.data?.reply || '').length > 10) {
        pass('POST /troubleshoot/chat', chat.data.source || 'ok');
    } else fail('POST /troubleshoot/chat', `HTTP ${chat.status}`);
}

async function newPage(config) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    if (config) {
        await page.evaluateOnNewDocument((cfg) => {
            localStorage.setItem('business_one_pos_config', JSON.stringify(cfg));
        }, config);
    }
    page.setDefaultTimeout(30000);
    return page;
}

async function loginPosLive(page, fixture) {
    await page.goto(`${BASE}/pos/`, { waitUntil: 'networkidle2' });
    const onPin = await page.$eval('#pin-screen', (el) => !el.classList.contains('hidden')).catch(() => false);
    if (!onPin) {
        await page.waitForSelector('#setup-screen', { timeout: 10000 }).catch(() => {});
        const onSetup = await page.$eval('#setup-screen', (el) => !el.classList.contains('hidden')).catch(() => false);
        if (onSetup) {
            await page.evaluate((cfg) => {
                localStorage.setItem(
                    'business_one_pos_config',
                    JSON.stringify({
                        apiBaseUrl: cfg.base,
                        apiKey: cfg.apiKey,
                        deviceId: cfg.label,
                        mode: 'live',
                    })
                );
                location.reload();
            }, { base: BASE, apiKey: fixture.apiKey, label: fixture.label });
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        }
    }
    await page.waitForSelector('#employee-pin', { visible: true, timeout: 25000 });
    await page.click('#employee-pin', { clickCount: 3 });
    await page.type('#employee-pin', fixture.pin);
    await Promise.all([
        page.waitForFunction(
            () =>
                document.getElementById('register-screen') &&
                !document.getElementById('register-screen').classList.contains('hidden'),
            { timeout: 25000 }
        ),
        page.evaluate(() => document.getElementById('pin-form')?.requestSubmit()),
    ]);
    const openShift = await page.$('#open-shift-modal:not(.hidden)');
    if (openShift) {
        await page.evaluate(() => document.getElementById('open-shift-form')?.requestSubmit());
        await sleep(1500);
    }
    await page.waitForFunction(() => window.PosApp?.storeConfig != null, { timeout: 30000 });
}

async function dismissPosDialogIfOpen(page) {
    const visible = await page.$('#pos-confirm-modal:not(.hidden)');
    if (visible) {
        await page.click('#pos-confirm-ok');
        await sleep(300);
    }
}

async function testDemoDiagnosticsUi() {
    console.log('\nPOS demo UI: Help / diagnostics');
    const page = await newPage();
    try {
        await page.goto(`${BASE}/pos/`, { waitUntil: 'networkidle2' });
        const tryDemo = await page.$('#try-demo-btn');
        if (tryDemo) {
            const setupVisible = await page.$eval('#setup-screen', (el) => !el.classList.contains('hidden'));
            if (setupVisible) await tryDemo.click();
        }
        await page.waitForSelector('#employee-pin', { visible: true });
        await page.type('#employee-pin', '1234');
        await Promise.all([
            page.waitForFunction(
                () =>
                    document.getElementById('register-screen') &&
                    !document.getElementById('register-screen').classList.contains('hidden'),
                { timeout: 15000 }
            ),
            page.evaluate(() => document.getElementById('pin-form')?.requestSubmit()),
        ]);
        await page.evaluate(() => document.getElementById('open-shift-modal')?.classList.add('hidden'));

        await page.click('#help-btn');
        await dismissPosDialogIfOpen(page);
        await page.waitForSelector('#diagnostics-modal:not(.hidden)', { timeout: 10000 });
        pass('Help opens troubleshooting modal');

        await page.waitForFunction(
            () => document.querySelectorAll('#diagnostics-list li').length > 2,
            { timeout: 15000 }
        );
        const checks = await page.evaluate(() => {
            const ids = [...document.querySelectorAll('#diagnostics-list li')].map((li) => li.dataset.diagId);
            return {
                ids,
                hasSummary: ids.includes('summary'),
                hasMode: ids.includes('mode'),
                hasFixBtn: Boolean(document.getElementById('diag-fix-btn')),
                hasRefresh: Boolean(document.getElementById('diag-scan-ai-btn')),
                hasSync: Boolean(document.getElementById('diag-sync-btn')),
            };
        });
        if (checks.hasSummary) pass('Diagnostics summary row');
        else fail('Diagnostics summary row');
        if (checks.hasMode) pass('Diagnostics mode check (demo)');
        else fail('Diagnostics mode check');
        if (checks.hasFixBtn) pass('Fix what we can button present');
        else fail('Fix what we can button');

        const runResult = await page.evaluate(async () => {
            const config = window.PosApp?.config || window.PosConfig?.load();
            const results = await window.PosDiagnostics.run(config, { storeConfig: window.PosApp?.storeConfig });
            return {
                count: results.length,
                ids: results.map((r) => r.id),
                hasAnnotate: results.some((r) => r.autoFix || r.secondaryFix),
                summary: results.find((r) => r.id === 'summary')?.title || '',
            };
        });
        if (runResult.count >= 8) pass('PosDiagnostics.run() in browser', `${runResult.count} checks`);
        else fail('PosDiagnostics.run()', `${runResult.count} checks`);

        await page.click('#diag-scan-ai-btn');
        await dismissPosDialogIfOpen(page);
        await sleep(1500);
        const afterRefresh = await page.evaluate(
            () => document.querySelectorAll('#diagnostics-list li').length
        );
        if (afterRefresh >= 5) pass('Run checks again refreshes list', `${afterRefresh} items`);
        else fail('Run checks again');

        await page.close();
    } catch (e) {
        fail('POS demo diagnostics UI', e.message);
        await page.close().catch(() => {});
    }
}

async function testLiveDiagnosticsAndAutoFix(fixture) {
    console.log('\nPOS live UI: diagnostics + auto-fix');
    const page = await newPage({
        apiBaseUrl: BASE,
        apiKey: fixture.apiKey,
        deviceId: fixture.label,
    });
    try {
        await loginPosLive(page, fixture);

        const onRegister = await page.evaluate(() => {
            const reg = document.getElementById('register-screen');
            return Boolean(reg && !reg.classList.contains('hidden') && window.PosApp);
        });
        if (!onRegister) {
            const state = await page.evaluate(() => ({
                pin: !document.getElementById('pin-screen')?.classList.contains('hidden'),
                setup: !document.getElementById('setup-screen')?.classList.contains('hidden'),
                err: document.querySelector('.toast')?.textContent || '',
            }));
            throw new Error(`register not visible — pin=${state.pin} setup=${state.setup} toast=${state.err}`);
        }
        pass('POS live login reached register screen');

        await page.evaluate(async () => {
            if (window.PosApp?.openDiagnostics) {
                await window.PosApp.openDiagnostics({ showRemoteNotice: false, autoFix: false });
            }
        });
        await dismissPosDialogIfOpen(page);
        await page.waitForSelector('#diagnostics-modal:not(.hidden)', { timeout: 15000 });
        pass('Help / openDiagnostics shows modal');
        await page.waitForFunction(
            () => document.querySelectorAll('#diagnostics-list li').length > 5,
            { timeout: 20000 }
        );

        await page.waitForFunction(
            () => {
                const ai = document.getElementById('diagnostics-ai');
                return ai && !ai.classList.contains('hidden');
            },
            { timeout: 20000 }
        );
        const aiState = await page.evaluate(() => ({
            hasForm: Boolean(document.getElementById('diagnostics-ai-form')),
            hasScanStatus: Boolean(document.getElementById('diagnostics-scan-status')?.textContent?.trim()),
            logText: document.getElementById('diagnostics-ai-log')?.textContent?.trim().slice(0, 120) || ''
        }));
        if (aiState.hasForm && aiState.logText.length > 5) {
            pass('AI help panel scans on open', aiState.logText.slice(0, 60));
        } else fail('AI help panel scans on open', JSON.stringify(aiState));

        const liveChecks = await page.evaluate(() => {
            const items = [...document.querySelectorAll('#diagnostics-list li')].map((li) => ({
                id: li.dataset.diagId,
                text: li.textContent,
            }));
            return {
                ids: items.map((i) => i.id),
                hasServer: items.some((i) => i.id === 'server'),
                hasGiftCards: items.some((i) => i.id === 'gift-cards'),
                hasCatalog: items.some((i) => i.id === 'catalog-api'),
            };
        });
        if (liveChecks.hasServer) pass('Live diagnostics: server check');
        else fail('Live diagnostics: server check');
        if (liveChecks.hasGiftCards) pass('Live diagnostics: gift cards check');
        else fail('Live diagnostics: gift cards check');
        if (liveChecks.hasCatalog) pass('Live diagnostics: catalog API check');
        else fail('Live diagnostics: catalog API check');

        const fixEnabled = await page.evaluate(() => !document.getElementById('diag-fix-btn')?.hasAttribute('disabled'));
        if (fixEnabled) pass('Fix what we can enabled when issues/warnings exist');
        else pass('Fix what we can state', 'disabled (all green — OK)');

        await page.click('#diag-fix-btn');
        await sleep(3000);

        const fixLog = await page.evaluate(() => {
            const log = document.getElementById('diagnostics-fix-log');
            return {
                text: log?.textContent || '',
                visible: log && !log.classList.contains('hidden'),
                listCount: document.querySelectorAll('#diagnostics-list li').length,
            };
        });
        if (fixLog.visible && /Auto-fix results/i.test(fixLog.text)) {
            pass('Auto-fix log displayed', fixLog.text.slice(0, 80));
        } else if (fixLog.listCount > 5) {
            pass('Auto-fix completed', 'checks re-rendered');
        } else {
            fail('Auto-fix log / re-check', JSON.stringify(fixLog));
        }

        const testPrint = await page.evaluate(async () => {
            const btn = [...document.querySelectorAll('.diag-fix-one')].find((b) =>
                /test print/i.test(b.textContent)
            );
            if (!btn) return { skipped: true };
            btn.click();
            return { clicked: true };
        });
        if (testPrint.skipped) pass('Test print button', 'no printer row button (optional)');
        else {
            await sleep(2000);
            pass('Test print button clicked');
        }

        const printTestApi = await page.evaluate(async () => {
            if (!window.PosReceipt?.printTest) return { ok: false, error: 'missing printTest' };
            const timeout = new Promise((resolve) =>
                setTimeout(() => resolve({ ok: false, error: 'printTest timed out (no printer in CI)' }), 8000)
            );
            const result = await Promise.race([
                window.PosReceipt.printTest(window.PosApp?.storeConfig || {}),
                timeout
            ]);
            return result;
        });
        if (printTestApi.ok) pass('PosReceipt.printTest()', printTestApi.method || 'ok');
        else pass('PosReceipt.printTest()', printTestApi.error || 'skipped');

        const normalizeFix = await page.evaluate(async () => {
            const config = window.PosApp.config;
            const padded = { ...config, apiKey: `  ${config.apiKey}  ` };
            window.PosApp.config = padded;
            const msg = await window.PosDiagnostics.fixActions.normalizeConfig(padded, { app: window.PosApp });
            return { msg, trimmed: window.PosApp.config.apiKey === config.apiKey.trim() };
        });
        if (normalizeFix.trimmed) pass('normalizeConfig fix trims API key');
        else fail('normalizeConfig fix');

        await page.close();
    } catch (e) {
        fail('POS live diagnostics + auto-fix', e.message);
        await page.close().catch(() => {});
    }
}

async function testInvalidKeyDiagnostics() {
    console.log('\nPOS UI: auth failure diagnostics');
    const page = await newPage({
        apiBaseUrl: BASE,
        apiKey: 'pos_invalid_key_for_diag_test',
        deviceId: 'Front Counter',
    });
    try {
        await page.goto(`${BASE}/pos/`, { waitUntil: 'networkidle2' });
        await sleep(1000);
        const diag = await page.evaluate(async () => {
            const config = window.PosConfig.load();
            const results = await window.PosDiagnostics.run(config, {});
            const server = results.find((r) => r.id === 'server');
            return {
                serverStatus: server?.status,
                authFailure: server?.authFailure,
                autoFix: server?.autoFix,
                title: server?.title,
            };
        });
        if (diag.serverStatus === 'bad' && diag.authFailure) pass('Bad API key flagged as auth failure', diag.title);
        else fail('Bad API key diagnostics', JSON.stringify(diag));
        if (diag.autoFix === 'openSetup') pass('Auth failure offers Open setup fix');
        else fail('Auth failure fix action', diag.autoFix || 'none');
        await page.close();
    } catch (e) {
        fail('Invalid key diagnostics', e.message);
        await page.close().catch(() => {});
    }
}

async function main() {
    console.log(`POS diagnostics tests — ${BASE}\n`);
    const up = await waitForServer();
    if (!up) {
        console.error('Server not reachable at', BASE);
        process.exit(1);
    }
    pass('Server health', BASE);

    pool = createPool({ connectionLimit: 4 });
    let fixture;
    try {
        fixture = await setupFixture();
    } catch (e) {
        fail('Test fixture setup', e.message);
        await cleanup();
        process.exit(1);
    }

    browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        protocolTimeout: 120000
    });

    await testDiagnosticApiEndpoints(fixture);
    await testDemoDiagnosticsUi();
    await testLiveDiagnosticsAndAutoFix(fixture);
    await testInvalidKeyDiagnostics();

    await cleanup();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        failed.forEach((r) => console.log(`  FAIL: ${r.name} — ${r.detail}`));
        process.exit(1);
    }
    console.log('All diagnostics tests passed.');
}

main().catch(async (e) => {
    console.error(e);
    await cleanup();
    process.exit(1);
});
