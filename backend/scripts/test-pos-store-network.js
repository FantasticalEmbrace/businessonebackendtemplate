'use strict';

const assert = require('assert');
const {
    normalizeMac,
    parseDhcpClientList,
    equipmentNeedsNetworkIp
} = require('../services/posStoreNetwork');

function testNormalizeMac() {
    assert.strictEqual(normalizeMac('aa:bb:cc:dd:ee:ff'), 'AA:BB:CC:DD:EE:FF');
    assert.strictEqual(normalizeMac('AA-BB-CC-DD-EE-FF'), 'AA:BB:CC:DD:EE:FF');
    assert.strictEqual(normalizeMac('aabbccddeeff'), 'AA:BB:CC:DD:EE:FF');
    assert.strictEqual(normalizeMac(''), '');
    assert.strictEqual(normalizeMac('bad'), '');
}

function testParseDhcp() {
    const text = `
Hostname    IP Address      MAC Address
PayPoint-1  192.168.1.45    AA:BB:CC:DD:EE:01
Star-TSP    192.168.1.46    AA-BB-CC-DD-EE-02
garbage line
A3700       10.0.0.5        11:22:33:44:55:66
`;
    const entries = parseDhcpClientList(text);
    assert.strictEqual(entries.length, 3);
    assert.deepStrictEqual(entries[0], {
        mac: 'AA:BB:CC:DD:EE:01',
        ip: '192.168.1.45',
        hostname: 'PayPoint-1'
    });
    assert.deepStrictEqual(entries[1], {
        mac: 'AA:BB:CC:DD:EE:02',
        ip: '192.168.1.46',
        hostname: 'Star-TSP'
    });
}

function testEquipmentNeedsNetworkIp() {
    assert.strictEqual(
        equipmentNeedsNetworkIp({
            equipmentType: 'register',
            config: {}
        }),
        true
    );
    assert.strictEqual(
        equipmentNeedsNetworkIp({
            equipmentType: 'receipt_printer',
            config: { connection: 'network' }
        }),
        true
    );
    assert.strictEqual(
        equipmentNeedsNetworkIp({
            equipmentType: 'receipt_printer',
            config: { connection: 'usb' }
        }),
        false
    );
}

testNormalizeMac();
testParseDhcp();
testEquipmentNeedsNetworkIp();
console.log('posStoreNetwork unit tests: OK');

async function integrationTest() {
    if (!process.argv.includes('--integration')) return;
    const { loadBackendEnv, createPool } = require('../utils/dbConfig');
    const { ensurePosSchema } = require('../utils/ensurePosSchema');
    const { createEquipment, getEquipmentById, deleteEquipment } = require('../services/posEquipment');
    const { createDevice, revokeDevice } = require('../services/posDeviceRegistry');
    const { matchDhcpEntriesToEquipment, applyNetworkAssignment } = require('../services/posStoreNetwork');

    loadBackendEnv();
    const pool = await createPool();
    await ensurePosSchema(pool);

    const testMac = 'DE:AD:BE:EF:00:99';
    const testIp = '192.168.99.88';
    const label = `Network test ${Date.now()}`;
    let created = null;
    let device = null;
    try {
        device = await createDevice(pool, `NetTest-${Date.now()}`.slice(0, 64));
        created = await createEquipment(pool, {
            equipmentType: 'receipt_printer',
            label,
            posDeviceId: device.id,
            macAddress: testMac,
            config: {
                catalogModelId: 'star_tsp143iii',
                catalogBrandId: 'star',
                connection: 'network',
                address: '0.0.0.0'
            },
            isActive: true
        });
        assert.ok(created?.id, 'equipment created');
        assert.strictEqual(created.macAddress, testMac);

        const dhcpText = `TestRegister  ${testIp}  ${testMac}`;
        const matchResult = await matchDhcpEntriesToEquipment(pool, dhcpText);
        const macMatch = matchResult.matches.find((m) => m.equipment.id === created.id);
        assert.ok(macMatch, 'DHCP matched equipment by MAC');
        assert.strictEqual(macMatch.suggestedIp, testIp);

        const updated = await applyNetworkAssignment(pool, created.id, {
            ip: testIp,
            mac: testMac
        });
        assert.strictEqual(updated.config.address, testIp);
        assert.strictEqual(updated.macAddress, testMac);

        const reloaded = await getEquipmentById(pool, created.id);
        assert.strictEqual(reloaded.config.address, testIp);
        console.log('posStoreNetwork integration test: OK');
    } finally {
        if (created?.id) {
            await deleteEquipment(pool, created.id);
        }
        if (device?.id) {
            await revokeDevice(pool, device.id);
        }
        await pool.end();
    }
}

integrationTest().catch((e) => {
    console.error(e);
    process.exit(1);
});
