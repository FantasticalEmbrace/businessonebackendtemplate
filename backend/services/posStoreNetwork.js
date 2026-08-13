'use strict';

const { listEquipment, getEquipmentById, updateEquipment } = require('./posEquipment');

const NETWORK_SETTING_KEYS = Object.freeze({
    routerUrl: 'pos_network_router_url',
    gatewayIp: 'pos_network_gateway_ip',
    subnetCidr: 'pos_network_subnet_cidr',
    notes: 'pos_network_notes'
});

/**
 * Recommended store POS network (10.224.16.0/24) — fixed addresses reserved on the router by MAC.
 * Stays off common 192.168.x home/modem ranges to reduce address conflicts.
 */
const STANDARD_STORE_NETWORK = Object.freeze({
    lanPrefix: '10.224.16',
    gatewayIp: '10.224.16.1',
    subnetCidr: '10.224.16.0/24',
    dhcpPoolStart: '10.224.16.128',
    dhcpPoolEnd: '10.224.16.254',
    stationStride: 16,
    stationBaseIps: [16, 32, 48]
});

function standardHostIp(hostOctet) {
    return `${STANDARD_STORE_NETWORK.lanPrefix}.${hostOctet}`;
}

const STATION_EQUIPMENT_IP_OFFSETS = Object.freeze({
    register: 0,
    card_terminal: 1,
    receipt_printer: 2,
    customer_display: 3,
    label_printer: 4,
    scale: 5,
    cash_drawer: 6
});

function buildStandardIpPlan() {
    const labels = {
        register: 'Register (PayPoint)',
        card_terminal: 'Card terminal (A3700)',
        receipt_printer: 'Receipt printer',
        customer_display: 'Customer display',
        label_printer: 'Label printer',
        scale: 'Scale',
        cash_drawer: 'Cash drawer (network kick)'
    };
    const rows = [];
    STANDARD_STORE_NETWORK.stationBaseIps.forEach((hostOctet, stationIdx) => {
        const station = stationIdx + 1;
        for (const [equipmentType, offset] of Object.entries(STATION_EQUIPMENT_IP_OFFSETS)) {
            rows.push({
                station,
                equipmentType,
                role: labels[equipmentType],
                ip: standardHostIp(hostOctet + offset),
                routerReservation: `Reserved address — MAC → ${standardHostIp(hostOctet + offset)}`
            });
        }
    });
    return rows;
}

function buildStandardNetworkNotes() {
    return [
        'Store POS network — fixed addresses reserved on the router.',
        'Router address: 10.224.16.1 · Network range: 10.224.16.0/24',
        'Automatic pool (other devices): 10.224.16.128–10.224.16.254',
        'Register 1 devices: .16–.22 · Register 2: .32–.38 · Register 3: .48–.54',
        'Wi‑Fi name: __________ · Wi‑Fi password: __________'
    ].join('\n');
}

function getStandardStoreNetworkTemplate() {
    return {
        gatewayIp: STANDARD_STORE_NETWORK.gatewayIp,
        subnetCidr: STANDARD_STORE_NETWORK.subnetCidr,
        dhcpPool: `${STANDARD_STORE_NETWORK.dhcpPoolStart}–${STANDARD_STORE_NETWORK.dhcpPoolEnd}`,
        method: 'dhcp_reservation',
        methodLabel: 'Fixed addresses reserved by hardware address (MAC) on the router',
        ipPlan: buildStandardIpPlan(),
        notesTemplate: buildStandardNetworkNotes(),
        setupSteps: [
            'In the router settings, set the store network to 10.224.16.1 and subnet mask 255.255.255.0.',
            'Set automatic addresses to 10.224.16.128–10.224.16.254 (for devices not in the table below).',
            'For each POS device: reserve a fixed address — MAC from sticker → address from the plan below.',
            'Add equipment with the same MAC; paste the router device list → Parse & match → Apply.',
            'Backup internet test: sale on normal internet, unplug modem, sale again on cellular backup.'
        ]
    };
}

function suggestedStandardIp(equipmentType, stationIndex = 0) {
    const base = STANDARD_STORE_NETWORK.stationBaseIps[stationIndex];
    if (base == null) return '';
    const offset = STATION_EQUIPMENT_IP_OFFSETS[equipmentType];
    if (offset == null) return '';
    return standardHostIp(base + offset);
}

const NETWORK_EQUIPMENT_TYPES = new Set([
    'register',
    'card_terminal',
    'receipt_printer',
    'customer_display',
    'label_printer',
    'scale',
    'cash_drawer'
]);

function normalizeMac(raw) {
    const hex = String(raw || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (hex.length !== 12) return '';
    return hex.match(/.{2}/g).join(':');
}

function parseDhcpClientList(text) {
    const entries = [];
    const seen = new Set();
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^(hostname|device|name|ip|mac|address|client)/i.test(trimmed) && !/\d/.test(trimmed.slice(0, 20))) {
            continue;
        }
        const macMatch = trimmed.match(/(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/);
        if (!macMatch) continue;
        const mac = normalizeMac(macMatch[0]);
        if (!mac) continue;
        const ipMatch = trimmed.match(
            /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/
        );
        if (!ipMatch) continue;
        const ip = ipMatch[0];
        const key = `${mac}|${ip}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let hostname = trimmed
            .replace(macMatch[0], ' ')
            .replace(ip, ' ')
            .replace(/[\t|,;]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (hostname.length < 2) hostname = '';
        entries.push({ mac, ip, hostname });
    }
    return entries;
}

async function loadStoreNetworkSettings(pool) {
    const keys = Object.values(NETWORK_SETTING_KEYS);
    const placeholders = keys.map(() => '?').join(',');
    const [rows] = await pool.execute(
        `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
        keys
    );
    const map = new Map((rows || []).map((r) => [r.key_name, r.value || '']));
    return {
        routerUrl: map.get(NETWORK_SETTING_KEYS.routerUrl) || '',
        gatewayIp: map.get(NETWORK_SETTING_KEYS.gatewayIp) || '',
        subnetCidr: map.get(NETWORK_SETTING_KEYS.subnetCidr) || '',
        notes: map.get(NETWORK_SETTING_KEYS.notes) || ''
    };
}

async function saveStoreNetworkSettings(pool, body) {
    const pairs = [
        [NETWORK_SETTING_KEYS.routerUrl, String(body?.routerUrl || '').trim().slice(0, 500)],
        [NETWORK_SETTING_KEYS.gatewayIp, String(body?.gatewayIp || '').trim().slice(0, 64)],
        [NETWORK_SETTING_KEYS.subnetCidr, String(body?.subnetCidr || '').trim().slice(0, 32)],
        [NETWORK_SETTING_KEYS.notes, String(body?.notes || '').trim().slice(0, 2000)]
    ];
    for (const [key, value] of pairs) {
        await pool.execute(
            `INSERT INTO settings (key_name, value, description, type)
             VALUES (?, ?, 'POS store network', 'string')
             ON DUPLICATE KEY UPDATE value = VALUES(value)`,
            [key, value]
        );
    }
    return loadStoreNetworkSettings(pool);
}

function hostnameScore(a, b) {
    const left = String(a || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
    const right = String(b || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
    if (!left || !right) return 0;
    if (left === right) return 90;
    if (left.includes(right) || right.includes(left)) return 70;
    return 0;
}

function equipmentNeedsNetworkIp(row) {
    if (!row || !NETWORK_EQUIPMENT_TYPES.has(row.equipmentType)) return false;
    const conn = String(row.config?.connection || '').toLowerCase();
    if (row.equipmentType === 'register') return true;
    if (row.equipmentType === 'card_terminal') {
        return ['ethernet', 'wifi', 'network'].includes(conn);
    }
    if (row.equipmentType === 'receipt_printer' || row.equipmentType === 'label_printer') {
        return conn === 'network';
    }
    if (row.equipmentType === 'customer_display') {
        return row.config?.mode === 'browser';
    }
    if (row.equipmentType === 'cash_drawer') {
        return row.config?.kickMode === 'network';
    }
    if (row.equipmentType === 'scale') {
        return conn === 'network';
    }
    return false;
}

async function matchDhcpEntriesToEquipment(pool, dhcpText) {
    const entries = parseDhcpClientList(dhcpText);
    const equipment = await listEquipment(pool, { includeInactive: false });
    const byMac = new Map();
    for (const row of equipment) {
        const mac = normalizeMac(row.macAddress);
        if (mac) byMac.set(mac, row);
    }

    const matches = [];
    const unmatchedEntries = [];

    for (const entry of entries) {
        const row = byMac.get(entry.mac);
        if (row) {
            matches.push({
                entry,
                equipment: summarizeMatchEquipment(row),
                confidence: 'mac',
                confidenceLabel: 'MAC match',
                currentIp: row.config?.address || '',
                suggestedIp: entry.ip
            });
        } else {
            let best = null;
            let bestScore = 0;
            for (const eq of equipment) {
                const score = hostnameScore(entry.hostname, eq.label);
                if (score > bestScore) {
                    bestScore = score;
                    best = eq;
                }
            }
            if (best && bestScore >= 70) {
                matches.push({
                    entry,
                    equipment: summarizeMatchEquipment(best),
                    confidence: 'hostname',
                    confidenceLabel: `Hostname guess (${bestScore}%)`,
                    currentIp: best.config?.address || '',
                    suggestedIp: entry.ip
                });
            } else {
                unmatchedEntries.push(entry);
            }
        }
    }

    const equipmentWithoutMac = equipment
        .filter((row) => equipmentNeedsNetworkIp(row) && !normalizeMac(row.macAddress))
        .map(summarizeMatchEquipment);

    return {
        parsedCount: entries.length,
        matches,
        unmatchedEntries,
        equipmentWithoutMac
    };
}

function summarizeMatchEquipment(row) {
    return {
        id: row.id,
        label: row.label,
        equipmentType: row.equipmentType,
        equipmentTypeLabel: row.equipmentTypeLabel,
        macAddress: normalizeMac(row.macAddress) || '',
        currentIp: row.config?.address || '',
        posDeviceLabel: row.posDeviceLabel || ''
    };
}

async function applyNetworkAssignment(pool, equipmentId, { ip, mac }) {
    const row = await getEquipmentById(pool, equipmentId);
    if (!row) {
        const err = new Error('Equipment not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (!NETWORK_EQUIPMENT_TYPES.has(row.equipmentType)) {
        const err = new Error('This equipment type does not use a network address');
        err.code = 'INVALID_EQUIPMENT';
        throw err;
    }

    const nextIp = String(ip || '').trim();
    if (!nextIp) {
        const err = new Error('IP address is required');
        err.code = 'IP_REQUIRED';
        throw err;
    }
    if (!/^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/.test(nextIp)) {
        const err = new Error('Invalid IP address');
        err.code = 'INVALID_IP';
        throw err;
    }

    const nextMac = mac ? normalizeMac(mac) : normalizeMac(row.macAddress);
    const config = { ...(row.config || {}), address: nextIp };

    return updateEquipment(pool, equipmentId, {
        equipmentType: row.equipmentType,
        label: row.label,
        manufacturer: row.manufacturer,
        model: row.model,
        serialNumber: row.serialNumber,
        macAddress: nextMac || row.macAddress,
        posDeviceId: row.posDeviceId,
        notes: row.notes,
        isActive: row.isActive,
        config
    });
}

async function recordRegisterNetworkReport(pool, posDeviceRecordId, { localIp, userAgent } = {}) {
    const id = Number(posDeviceRecordId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const ip = String(localIp || '').trim();
    if (!ip) return null;
    await pool.execute(
        `INSERT INTO pos_register_network_reports (pos_device_id, reported_ip, user_agent)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reported_ip = VALUES(reported_ip), user_agent = VALUES(user_agent), reported_at = CURRENT_TIMESTAMP`,
        [id, ip.slice(0, 64), String(userAgent || '').slice(0, 500) || null]
    );
    return { posDeviceId: id, reportedIp: ip };
}

async function listRegisterNetworkReports(pool) {
    const [rows] = await pool.execute(
        `SELECT r.pos_device_id, d.device_label, r.reported_ip, r.user_agent, r.reported_at
         FROM pos_register_network_reports r
         JOIN pos_devices d ON d.id = r.pos_device_id
         ORDER BY r.reported_at DESC`
    );
    return (rows || []).map((r) => ({
        posDeviceId: r.pos_device_id,
        deviceLabel: r.device_label,
        reportedIp: r.reported_ip,
        userAgent: r.user_agent,
        reportedAt: r.reported_at
    }));
}

module.exports = {
    NETWORK_SETTING_KEYS,
    STANDARD_STORE_NETWORK,
    normalizeMac,
    parseDhcpClientList,
    loadStoreNetworkSettings,
    saveStoreNetworkSettings,
    matchDhcpEntriesToEquipment,
    applyNetworkAssignment,
    recordRegisterNetworkReport,
    listRegisterNetworkReports,
    equipmentNeedsNetworkIp,
    getStandardStoreNetworkTemplate,
    suggestedStandardIp
};
