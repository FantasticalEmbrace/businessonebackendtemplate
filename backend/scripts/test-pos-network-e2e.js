#!/usr/bin/env node
'use strict';

/**
 * End-to-end verification for POS store network / MAC feature.
 * Covers every admin field, button API, equipment MAC field, and register IP report.
 *
 * Run: node scripts/test-pos-network-e2e.js
 * Optional: --base http://127.0.0.1:3001  (HTTP API layer; server must be running)
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const assert = require('assert');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const { ensurePosSchema } = require('../utils/ensurePosSchema');
const { createEquipment, getEquipmentById, updateEquipment, deleteEquipment } = require('../services/posEquipment');
const { createDevice, revokeDevice } = require('../services/posDeviceRegistry');
const {
    normalizeMac,
    parseDhcpClientList,
    loadStoreNetworkSettings,
    saveStoreNetworkSettings,
    matchDhcpEntriesToEquipment,
    applyNetworkAssignment,
    recordRegisterNetworkReport,
    listRegisterNetworkReports
} = require('../services/posStoreNetwork');
const { buildStoreTroubleshootReport } = require('../services/posStoreTroubleshoot');

loadBackendEnv();

const BASE = (() => {
    const i = process.argv.indexOf('--base');
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/+$/, '');
    return 'http://127.0.0.1:3001';
})();

const TAG = `NET-E2E-${Date.now()}`;
const results = [];

function pass(name, detail = '') {
    results.push({ ok: true, name, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
    results.push({ ok: false, name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

function check(name, condition, detail = '') {
    if (condition) pass(name, detail);
    else fail(name, detail || 'assertion failed');
}

async function api(path, { token, method = 'GET', body, headers = {} } = {}) {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: h,
        body: body != null ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

function staticHtmlChecks() {
    console.log('\nStatic UI elements (admin.html)');
    const htmlPath = path.join(__dirname, '..', '..', 'admin.html');
    const hubPath = path.join(__dirname, '..', '..', 'admin-pos-hub.js');
    const tsPath = path.join(__dirname, '..', '..', 'admin-pos-troubleshoot.js');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const hub = fs.readFileSync(hubPath, 'utf8');
    const tsHub = fs.existsSync(tsPath) ? fs.readFileSync(tsPath, 'utf8') : '';
    const adminJs = hub + '\n' + tsHub;

    const requiredIds = [
        'pos-network-settings-form',
        'pos-network-router-url',
        'pos-network-gateway-ip',
        'pos-network-subnet',
        'pos-network-notes',
        'pos-network-settings-msg',
        'pos-network-dhcp-paste',
        'pos-network-parse-btn',
        'pos-network-apply-all-btn',
        'pos-network-parse-msg',
        'pos-network-matches',
        'pos-network-unmatched',
        'pos-network-missing-mac',
        'pos-network-register-reports-wrap',
        'pos-network-register-reports',
        'pos-equipment-mac',
        'pos-network-save-btn'
    ];
    for (const id of requiredIds) {
        check(`HTML has #${id}`, html.includes(`id="${id}"`));
    }
    check('HTML has network setup guide', html.includes('pos-network-setup-guide'));
    check('HTML has setup assistant', html.includes('id="pos-network-setup-assistant"'));
    check('HTML has troubleshoot assistant', html.includes('id="pos-troubleshoot-assistant"'));
    check('HTML has troubleshoot chat form', html.includes('id="pos-troubleshoot-chat-form"'));
    check('HTML loads troubleshoot script', html.includes('admin-pos-troubleshoot.js'));
        check('HTML has AI chat form', html.includes('id="pos-network-assistant-chat-form"'));
    check('HTML has setup status panel', html.includes('id="pos-network-assistant-status"'));

    const requiredHandlers = [
        'loadStoreNetwork',
        'parseDhcpList',
        'applyNetworkMatch',
        'applyAllMacMatches',
        'bindStoreNetwork',
        'refreshSetupAssistant',
        'runSetupAction',
        'bindSetupAssistant',
        'sendAiChat',
        'fetchAiBriefing',
        'fetchAiCoachForStep',
        'renderSetupStatusPanel',
        '/network/setup-assistant/chat',
        '/network/setup-assistant/briefing',
        '/network/setup-assistant/coach',
        '/network/setup-assistant',
        '/troubleshoot-assistant/chat',
        '/troubleshoot-assistant/briefing',
        '/troubleshoot-assistant',
        'AdminPosTroubleshoot',
        'pos-equipment-mac',
        'macAddress:',
        'pos-network-save-btn',
        'loadStoreNetwork'
    ];
    for (const snippet of requiredHandlers) {
        check(`admin POS JS wires ${snippet}`, adminJs.includes(snippet));
    }
}

async function serviceLayerTests(pool) {
    console.log('\nService layer (database)');

    const savedSettings = await loadStoreNetworkSettings(pool);
    check('GET network settings returns object', typeof savedSettings === 'object');

    const routerUrl = `http://192.168.50.1/?t=${TAG}`;
    const gatewayIp = '192.168.50.1';
    const subnetCidr = '192.168.50.0/24';
    const notes = `E2E notes ${TAG}`;

    const updatedSettings = await saveStoreNetworkSettings(pool, {
        routerUrl,
        gatewayIp,
        subnetCidr,
        notes
    });
    check('PUT routerUrl saved', updatedSettings.routerUrl === routerUrl);
    check('PUT gatewayIp saved', updatedSettings.gatewayIp === gatewayIp);
    check('PUT subnetCidr saved', updatedSettings.subnetCidr === subnetCidr);
    check('PUT notes saved', updatedSettings.notes === notes);

    const reloaded = await loadStoreNetworkSettings(pool);
    check('Settings persist after reload', reloaded.routerUrl === routerUrl);

    const mac1 = 'AA:11:22:33:44:55';
    const mac2 = 'AA:11:22:33:44:66';
    const ip1 = '192.168.50.45';
    const ip2 = '192.168.50.46';
    let device = null;
    let printer = null;
    let register = null;

    try {
        device = await createDevice(pool, `E2E-${TAG}`.slice(0, 64));

        printer = await createEquipment(pool, {
            equipmentType: 'receipt_printer',
            label: `E2E Printer ${TAG}`,
            posDeviceId: device.id,
            macAddress: mac1,
            config: {
                connection: 'network',
                address: '0.0.0.0'
            },
            isActive: true
        });
        check('Equipment create with macAddress', printer.macAddress === mac1);

        register = await createEquipment(pool, {
            equipmentType: 'register',
            label: `E2E Register ${TAG}`,
            posDeviceId: device.id,
            serialNumber: `SER-${TAG}`,
            macAddress: mac2,
            config: {
                address: '0.0.0.0'
            },
            isActive: true
        });
        check('Register create with macAddress', register.macAddress === mac2);

        const edited = await updateEquipment(pool, printer.id, {
            macAddress: 'AA1122334455',
            config: { ...printer.config, address: printer.config.address }
        });
        check('Equipment PUT macAddress (no-colon format)', edited.macAddress === mac1);

        const dhcpText = `
PayPoint  ${ip2}  ${mac2}
StarPrint ${ip1}  ${mac1}
Unknown   192.168.50.99  FF:FF:FF:FF:FF:FF
`;
        const parseResult = await matchDhcpEntriesToEquipment(pool, dhcpText);
        check('Parse DHCP parsedCount >= 3', parseResult.parsedCount >= 3, String(parseResult.parsedCount));
        check(
            'Parse DHCP MAC match for printer',
            parseResult.matches.some((m) => m.equipment.id === printer.id && m.confidence === 'mac')
        );
        check(
            'Parse DHCP MAC match for register',
            parseResult.matches.some((m) => m.equipment.id === register.id && m.confidence === 'mac')
        );
        check('Parse DHCP unmatched entry exists', parseResult.unmatchedEntries.length >= 1);

        const appliedPrinter = await applyNetworkAssignment(pool, printer.id, { ip: ip1, mac: mac1 });
        check('Apply single IP to printer', appliedPrinter.config.address === ip1);
        check('Apply single MAC preserved', appliedPrinter.macAddress === mac1);

        const appliedRegister = await applyNetworkAssignment(pool, register.id, { ip: ip2, mac: mac2 });
        check('Apply single IP to register', appliedRegister.config.address === ip2);

        const fromDb = await getEquipmentById(pool, printer.id);
        check('Applied IP persists in DB', fromDb.config.address === ip1);

        const report = await recordRegisterNetworkReport(pool, device.id, {
            localIp: '192.168.50.77',
            userAgent: 'e2e-test'
        });
        check('Register network report recorded', report?.reportedIp === '192.168.50.77');

        const reports = await listRegisterNetworkReports(pool);
        check(
            'Register reports list includes device',
            reports.some((r) => r.posDeviceId === device.id && r.reportedIp === '192.168.50.77')
        );

        const appliedFromReport = await applyNetworkAssignment(pool, register.id, {
            ip: '192.168.50.77',
            mac: mac2
        });
        check('Apply from register report IP', appliedFromReport.config.address === '192.168.50.77');

        try {
            await applyNetworkAssignment(pool, printer.id, { ip: 'not-an-ip', mac: mac1 });
            fail('Apply rejects invalid IP');
        } catch (e) {
            check('Apply rejects invalid IP', e.code === 'INVALID_IP', e.message);
        }

        try {
            await updateEquipment(pool, printer.id, { macAddress: 'BADMAC' });
            fail('Equipment rejects invalid MAC');
        } catch (e) {
            check('Equipment rejects invalid MAC', e.code === 'INVALID_MAC', e.message);
        }

        const troubleshoot = await buildStoreTroubleshootReport(pool, {});
        check('Troubleshoot report returns statusReport', troubleshoot?.statusReport?.headline != null);
        check('Troubleshoot report lists issues array', Array.isArray(troubleshoot?.statusReport?.issues));
        check('Troubleshoot report has counts', typeof troubleshoot?.counts?.registers === 'number');
    } finally {
        if (printer?.id) await deleteEquipment(pool, printer.id);
        if (register?.id) await deleteEquipment(pool, register.id);
        if (device?.id) await revokeDevice(pool, device.id);
    }
}

async function httpApiTests(pool) {
    console.log('\nHTTP API (mirrors every admin button)');

    let serverUp = false;
    try {
        const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
        serverUp = health.ok;
    } catch {
        serverUp = false;
    }
    if (!serverUp) {
        fail('HTTP server reachable', `Start backend on ${BASE} to test API routes`);
        return;
    }
    pass('HTTP server reachable');

    const [admins] = await pool.execute(
        `SELECT id, role FROM admin_users WHERE is_active = 1 AND role IN ('admin','developer','manager','assistant_manager','super_admin') LIMIT 1`
    );
    if (!admins.length || !process.env.JWT_SECRET) {
        fail('Admin token for API tests', 'No active manager admin or JWT_SECRET');
        return;
    }
    const token = jwt.sign({ adminId: admins[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    pass('Admin JWT created', `admin id ${admins[0].id}`);

    let device = null;
    let printer = null;
    const mac = 'BB:22:33:44:55:66';
    const ip = '192.168.60.10';

    try {
        const getNet = await api('/api/admin/pos/network', { token });
        check('GET /admin/pos/network', getNet.status === 200 && getNet.data?.settings != null, `HTTP ${getNet.status}`);
        check(
            'GET returns registerReports array',
            Array.isArray(getNet.data?.registerReports),
            `length ${getNet.data?.registerReports?.length}`
        );
        check('GET does not expose recommended IP plan', getNet.data?.standardTemplate == null);

        const getAssistant = await api('/api/admin/pos/network/setup-assistant', { token });
        check('GET /network/setup-assistant', getAssistant.status === 200 && Array.isArray(getAssistant.data?.assistant?.steps));
        check('Setup assistant returns AI config', getAssistant.data?.ai != null && typeof getAssistant.data.ai.enabled === 'boolean');
        check(
            'Setup assistant has network_settings step',
            getAssistant.data?.assistant?.steps?.some((s) => s.id === 'network_settings')
        );
        check(
            'Setup assistant includes statusReport',
            getAssistant.data?.assistant?.statusReport?.headline != null &&
                Array.isArray(getAssistant.data?.assistant?.statusReport?.missingItems)
        );

        const briefing = await api('/api/admin/pos/network/setup-assistant/briefing', {
            token,
            method: 'POST',
            body: { clientState: {} }
        });
        check('POST setup-assistant/briefing', briefing.status === 200 && String(briefing.data?.reply || '').length > 10);
        check('Briefing includes fingerprint', Boolean(briefing.data?.fingerprint));

        const askAssistant = await api('/api/admin/pos/network/setup-assistant/ask', {
            token,
            method: 'POST',
            body: { question: 'What is a MAC address?' }
        });
        check('POST setup-assistant/ask', askAssistant.status === 200 && String(askAssistant.data?.answer || askAssistant.data?.reply || '').length > 10);

        const getTroubleshoot = await api('/api/admin/pos/troubleshoot-assistant', { token });
        check(
            'GET /troubleshoot-assistant',
            getTroubleshoot.status === 200 && getTroubleshoot.data?.report?.statusReport != null
        );
        check('Troubleshoot returns AI config', getTroubleshoot.data?.ai != null);

        const tsBriefing = await api('/api/admin/pos/troubleshoot-assistant/briefing', {
            token,
            method: 'POST',
            body: { clientState: {} }
        });
        check('POST troubleshoot-assistant/briefing', tsBriefing.status === 200 && String(tsBriefing.data?.reply || '').length > 10);

        const tsChat = await api('/api/admin/pos/troubleshoot-assistant/chat', {
            token,
            method: 'POST',
            body: { message: 'Why might a register not print?' }
        });
        check('POST troubleshoot-assistant/chat', tsChat.status === 200 && String(tsChat.data?.reply || '').length > 10);

        const putNet = await api('/api/admin/pos/network', {
            token,
            method: 'PUT',
            body: {
                routerUrl: `http://10.0.0.1/${TAG}`,
                gatewayIp: '10.0.0.1',
                subnetCidr: '10.0.0.0/24',
                notes: `HTTP e2e ${TAG}`
            }
        });
        check('PUT /admin/pos/network (Save network settings)', putNet.status === 200 && putNet.data?.settings?.gatewayIp === '10.0.0.1');

        device = await createDevice(pool, `HTTP-${TAG}`.slice(0, 64));
        printer = await createEquipment(pool, {
            equipmentType: 'receipt_printer',
            label: `HTTP Printer ${TAG}`,
            posDeviceId: device.id,
            macAddress: mac,
            config: {
                connection: 'network',
                address: '0.0.0.0'
            },
            isActive: true
        });

        const parse = await api('/api/admin/pos/network/parse-dhcp', {
            token,
            method: 'POST',
            body: { dhcpText: `HttpTest ${ip} ${mac}` }
        });
        check('POST /network/parse-dhcp (Parse & match)', parse.status === 200 && parse.data?.parsedCount >= 1);
        check(
            'Parse API returns MAC match',
            parse.data?.matches?.some((m) => m.equipment?.id === printer.id),
            `${parse.data?.matches?.length || 0} matches`
        );

        const apply = await api('/api/admin/pos/network/apply', {
            token,
            method: 'POST',
            body: { equipmentId: printer.id, ip, mac }
        });
        check('POST /network/apply (Apply button)', apply.status === 200 && apply.data?.equipment?.config?.address === ip);

        const getEq = await api('/api/admin/pos/equipment', { token });
        const row = getEq.data?.equipment?.find((e) => e.id === printer.id);
        check('GET /equipment lists applied IP', row?.config?.address === ip);
        check('GET /equipment lists MAC', row?.macAddress === mac);

        const mac2 = 'BB:22:33:44:55:77';
        const ip2 = '192.168.60.11';
        const printer2 = await createEquipment(pool, {
            equipmentType: 'receipt_printer',
            label: `HTTP Printer2 ${TAG}`,
            posDeviceId: device.id,
            macAddress: mac2,
            config: {
                connection: 'network',
                address: '0.0.0.0'
            },
            isActive: true
        });

        const applyAll = await api('/api/admin/pos/network/apply-all', {
            token,
            method: 'POST',
            body: {
                matches: [
                    { equipmentId: printer.id, ip: '192.168.60.20', mac },
                    { equipmentId: printer2.id, ip: ip2, mac: mac2 }
                ]
            }
        });
        check(
            'POST /network/apply-all (Apply all MAC matches)',
            applyAll.status === 200 && applyAll.data?.appliedCount === 2,
            `applied ${applyAll.data?.appliedCount}`
        );

        const putEq = await api(`/api/admin/pos/equipment/${printer.id}`, {
            token,
            method: 'PUT',
            body: {
                equipmentType: printer.equipmentType,
                label: printer.label,
                posDeviceId: device.id,
                macAddress: 'BB2233445566',
                config: { ...printer.config, address: '192.168.60.20' },
                isActive: true
            }
        });
        check('PUT /equipment/:id macAddress field', putEq.status === 200 && putEq.data?.equipment?.macAddress === mac);

        const posReport = await fetch(`${BASE}/api/pos/v1/network/report`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-POS-API-Key': device.apiKey,
                'X-POS-Device-Id': device.deviceLabel
            },
            body: JSON.stringify({ localIp: '192.168.60.88' })
        });
        const posReportData = await posReport.json().catch(() => ({}));
        check(
            'PUT /pos/v1/network/report (register IP report)',
            posReport.status === 200 && posReportData?.reportedIp === '192.168.60.88',
            `HTTP ${posReport.status}`
        );

        const getNet2 = await api('/api/admin/pos/network', { token });
        check(
            'GET network after register report',
            getNet2.data?.registerReports?.some((r) => r.posDeviceId === device.id && r.reportedIp === '192.168.60.88')
        );

        await deleteEquipment(pool, printer2.id);
    } finally {
        if (printer?.id) await deleteEquipment(pool, printer.id);
        if (device?.id) await revokeDevice(pool, device.id);
    }
}

async function parserEdgeCases() {
    console.log('\nDHCP parser edge cases');
    check('Empty paste returns 0 entries', parseDhcpClientList('').length === 0);
    check('Header-only skipped', parseDhcpClientList('Hostname IP MAC').length === 0);
    check(
        'Tab-separated line',
        parseDhcpClientList('Device1\t192.168.1.5\tAA:BB:CC:DD:EE:0A')[0]?.ip === '192.168.1.5'
    );
    check('normalizeMac dedupes', normalizeMac('aa-bb-cc-dd-ee-ff') === 'AA:BB:CC:DD:EE:FF');
}

async function main() {
    console.log(`POS network E2E — ${TAG}`);
    staticHtmlChecks();
    parserEdgeCases();

    const pool = await createPool();
    await ensurePosSchema(pool);
    try {
        await serviceLayerTests(pool);
        await httpApiTests(pool);
    } finally {
        await pool.end();
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('\nFailed:');
        for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
        process.exit(1);
    }
    console.log('\nAll network / MAC fields and buttons verified.');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
