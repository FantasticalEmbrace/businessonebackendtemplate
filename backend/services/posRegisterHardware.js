'use strict';

const { listEquipmentForRegister } = require('./posEquipment');
const { findModel, isPayPointModel, isAndroidAioRegister, fieldRequired, fieldVisible } = require('./posHardwareCatalog');

const PRINTER_DRIVER_MAP = Object.freeze({
    elo_star: 'elo_star',
    star_android: 'star_android',
    star_network: 'star_network',
    escpos_network: 'escpos_network',
    browser: 'browser',
    zebra_label: 'browser',
    brother_label: 'browser'
});

/** Built-in / USB Star on device (EloView bridge or Capacitor StarIO10) — not network ESC/POS. */
function isLocalStarPrinterDriver(driver) {
    const d = String(driver || '').trim().toLowerCase();
    return d === 'elo_star' || d === 'star_android';
}

function pickFirst(equipment, type) {
    return (equipment || []).find((e) => e.equipmentType === type && e.isActive) || null;
}

function resolvePrinterDriver(printerRow, registerRow, globalPrinter) {
    const modelId = printerRow?.config?.catalogModelId || registerRow?.config?.catalogModelId;
    const modelDef = modelId ? findModel(modelId) : null;
    if (modelDef?.driver && PRINTER_DRIVER_MAP[modelDef.driver]) {
        return PRINTER_DRIVER_MAP[modelDef.driver];
    }
    if (registerRow?.config?.catalogModelId) {
        const regModel = findModel(registerRow.config.catalogModelId);
        if (regModel?.driver === 'elo_star') return 'elo_star';
        if (regModel?.driver === 'star_android') return 'star_android';
    }
    const g = String(globalPrinter || 'auto').trim();
    if (g === 'elo_star' || g === 'star_android' || g === 'browser') return g;
    return 'auto';
}

function resolvePoiDeviceId(cardTerminalRow, globalPoiDeviceId) {
    const fromEquipment = String(cardTerminalRow?.config?.poiDeviceId || '').trim();
    if (fromEquipment) return fromEquipment;
    return String(globalPoiDeviceId || '').trim();
}

function resolveLinkedPrinter(cashDrawerRow, equipment) {
    const linkedId = Number(cashDrawerRow?.config?.linkedPrinterEquipmentId);
    if (!Number.isInteger(linkedId) || linkedId <= 0) return null;
    return (equipment || []).find((e) => e.id === linkedId && e.equipmentType === 'receipt_printer') || null;
}

function missingConfigFields(row) {
    if (!row?.config?.catalogModelId) return [];
    const modelDef = findModel(row.config.catalogModelId);
    if (!modelDef) return [];
    const cfg = row.config || {};
    const missing = [];
    for (const field of modelDef.configFields || []) {
        if (!fieldVisible(field, cfg)) continue;
        if (!fieldRequired(field, cfg)) continue;
        const val = cfg[field.key];
        if (val == null || String(val).trim() === '') {
            missing.push(field.label);
        }
    }
    return missing;
}

function buildIssues({
    register,
    cardTerminal,
    receiptPrinter,
    cashDrawer,
    customerDisplay,
    labelPrinter,
    scale,
    linkedPrinter,
    poiDeviceId,
    printerDriver
}) {
    const issues = [];

    if (!register) {
        issues.push('No POS register equipment assigned to this station.');
    } else {
        if (!String(register.serialNumber || '').trim()) {
            issues.push('Register is missing serial number.');
        }
        const regModelId = register.config?.catalogModelId;
        if (isPayPointModel(regModelId) || isAndroidAioRegister(regModelId)) {
            if (!String(register.config?.address || '').trim()) {
                issues.push('Register is missing device IP/hostname.');
            }
        } else if (register.config?.connection === 'network' && !String(register.config?.address || '').trim()) {
            issues.push('Register is missing IP/hostname for network connection.');
        }
        missingConfigFields(register).forEach((label) => {
            issues.push(`Register missing ${label}.`);
        });
    }

    if (!cardTerminal) {
        issues.push('No payment terminal assigned — card sales use store-wide POI ID if set under Payments.');
    } else {
        if (!String(cardTerminal.serialNumber || '').trim()) {
            issues.push('Payment terminal is missing serial number.');
        }
        if (!poiDeviceId) {
            issues.push('Payment terminal is missing NMI POI device ID.');
        }
        missingConfigFields(cardTerminal).forEach((label) => {
            issues.push(`Payment terminal missing ${label}.`);
        });
    }

    if (!receiptPrinter && !isLocalStarPrinterDriver(printerDriver)) {
        issues.push('No receipt printer assigned — receipts will use browser print.');
    } else if (receiptPrinter) {
        missingConfigFields(receiptPrinter).forEach((label) => {
            issues.push(`Receipt printer missing ${label}.`);
        });
        if (receiptPrinter.config?.connection === 'network' && !String(receiptPrinter.config?.address || '').trim()) {
            issues.push('Receipt printer is missing network address.');
        }
    }

    if (cashDrawer) {
        const kickMode = cashDrawer.config?.kickMode || 'printer';
        if (kickMode === 'network') {
            if (!String(cashDrawer.config?.address || '').trim()) {
                issues.push('Network cash drawer is missing interface IP/hostname.');
            }
        } else if (!linkedPrinter && !isLocalStarPrinterDriver(printerDriver)) {
            issues.push('Cash drawer is not linked to a receipt printer.');
        }
        missingConfigFields(cashDrawer).forEach((label) => {
            issues.push(`Cash drawer missing ${label}.`);
        });
    }

    if (customerDisplay) {
        missingConfigFields(customerDisplay).forEach((label) => {
            issues.push(`Customer display missing ${label}.`);
        });
        if (customerDisplay.config?.mode === 'browser') {
            const hasUrl = String(customerDisplay.config?.url || '').trim();
            const hasHost = String(customerDisplay.config?.address || '').trim();
            if (!hasUrl && !hasHost) {
                issues.push('Customer display needs a browser URL or display device IP.');
            }
        }
    }

    if (labelPrinter) {
        missingConfigFields(labelPrinter).forEach((label) => {
            issues.push(`Label printer missing ${label}.`);
        });
    }

    if (scale) {
        missingConfigFields(scale).forEach((label) => {
            issues.push(`Scale missing ${label}.`);
        });
    }

    if (linkedPrinter && linkedPrinter.config?.connection === 'network' && !linkedPrinter.config?.address) {
        issues.push('Linked receipt printer is missing network address.');
    }

    return issues;
}

/**
 * Merge assigned equipment for a register into a runtime profile consumed by POS / checkout.
 */
async function buildRegisterHardwareProfile(pool, posDeviceRecordId, options = {}) {
    const globalCheckout = options.globalCheckout || {};
    const globalPrinter = options.globalPrinter || 'auto';

    const equipment = await listEquipmentForRegister(pool, posDeviceRecordId);

    const register = pickFirst(equipment, 'register');
    const cardTerminal = pickFirst(equipment, 'card_terminal');
    const receiptPrinter = pickFirst(equipment, 'receipt_printer');
    const cashDrawer = pickFirst(equipment, 'cash_drawer');
    const barcodeScanner = pickFirst(equipment, 'barcode_scanner');
    const customerDisplay = pickFirst(equipment, 'customer_display');
    const labelPrinterRow = pickFirst(equipment, 'label_printer');
    const scale = pickFirst(equipment, 'scale');

    const linkedPrinter = cashDrawer ? resolveLinkedPrinter(cashDrawer, equipment) : null;
    const effectivePrinter = receiptPrinter || linkedPrinter;
    const printerDriver = resolvePrinterDriver(effectivePrinter, register, globalPrinter);
    const poiDeviceId = resolvePoiDeviceId(cardTerminal, globalCheckout.poiDeviceId);

    const issues = buildIssues({
        register,
        cardTerminal,
        receiptPrinter,
        cashDrawer,
        customerDisplay,
        labelPrinter: labelPrinterRow,
        scale,
        linkedPrinter,
        poiDeviceId,
        printerDriver
    });

    const cardModel = cardTerminal?.config?.catalogModelId
        ? findModel(cardTerminal.config.catalogModelId)
        : null;

    const registerAddress = String(register?.config?.address || '').trim();
    const registerConnection = String(register?.config?.connection || 'integrated').toLowerCase();
    const registerSerial = String(register?.serialNumber || '').trim();
    let customerDisplayUrl = String(customerDisplay?.config?.url || '').trim();
    const displayHost = String(customerDisplay?.config?.address || '').trim();
    if (!customerDisplayUrl && displayHost) {
        const host = displayHost.replace(/^https?:\/\//i, '');
        customerDisplayUrl = `http://${host}/business-one-pos/display.html`;
    } else if (!customerDisplayUrl && registerAddress && (customerDisplay?.config?.mode === 'browser' || !customerDisplay)) {
        const host = registerAddress.replace(/^https?:\/\//i, '');
        if (isPayPointModel(register?.config?.catalogModelId) || isAndroidAioRegister(register?.config?.catalogModelId)) {
            customerDisplayUrl = `http://${host}/business-one-pos/display.html`;
        }
    }

    return {
        ready: issues.length === 0 || Boolean(poiDeviceId && (receiptPrinter || isLocalStarPrinterDriver(printerDriver))),
        issues,
        equipmentCount: equipment.length,
        register: summarizeEquipment(register, {
            serialNumber: registerSerial,
            connection: registerConnection,
            address: registerAddress
        }),
        cardTerminal: summarizeEquipment(cardTerminal, {
            processor: cardModel?.driver || '',
            terminalAddress: String(cardTerminal?.config?.address || cardTerminal?.config?.terminalIp || '').trim()
        }),
        receiptPrinter: summarizeEquipment(receiptPrinter || linkedPrinter, {
            driver: printerDriver,
            printerPort: effectivePrinter?.config?.port || '9100'
        }),
        cashDrawer: summarizeEquipment(cashDrawer, {
            linkedPrinterEquipmentId: cashDrawer?.config?.linkedPrinterEquipmentId || null,
            kickVia:
                cashDrawer?.config?.kickMode === 'network'
                    ? 'network'
                    : linkedPrinter
                      ? 'receipt_printer'
                      : isLocalStarPrinterDriver(printerDriver)
                        ? 'register'
                        : 'none',
            drawerAddress: cashDrawer?.config?.address || ''
        }),
        barcodeScanner: summarizeEquipment(barcodeScanner),
        customerDisplay: summarizeEquipment(customerDisplay, {
            displayUrl: customerDisplayUrl
        }),
        labelPrinter: summarizeEquipment(labelPrinterRow, {
            labelPort: labelPrinterRow?.config?.port || '9100'
        }),
        scale: summarizeEquipment(scale),
        runtime: {
            printerDriver,
            printerConnection: effectivePrinter?.config?.connection || '',
            printerAddress: effectivePrinter?.config?.address || '',
            printerPort: effectivePrinter?.config?.port || '9100',
            paperWidth: effectivePrinter?.config?.paperWidth || register?.config?.paperWidth || '80',
            poiDeviceId,
            cardTerminalConfigured: Boolean(poiDeviceId),
            cardTerminalDriver: cardModel?.driver || 'nmi',
            cardTerminalAddress: String(cardTerminal?.config?.address || cardTerminal?.config?.terminalIp || '').trim(),
            cardTerminalConnection: cardTerminal?.config?.connection || '',
            cashDrawerKickVia:
                cashDrawer?.config?.kickMode === 'network'
                    ? 'network'
                    : linkedPrinter
                      ? 'printer'
                      : isLocalStarPrinterDriver(printerDriver)
                        ? 'register'
                        : 'none',
            cashDrawerAddress: cashDrawer?.config?.address || '',
            linkedPrinterEquipmentId: cashDrawer?.config?.linkedPrinterEquipmentId || null,
            barcodeScannerMode: barcodeScanner?.config?.connection || 'keyboard_wedge',
            customerDisplayMode: customerDisplay?.config?.mode || 'browser',
            customerDisplayUrl,
            customerDisplayHost: displayHost,
            customerDisplayIndex: customerDisplay?.config?.displayIndex || '1',
            customerDisplayEquipmentId: customerDisplay?.id || null,
            adPlaylistMode: customerDisplay?.config?.adPlaylistMode || 'all',
            labelPrinterAddress: labelPrinterRow?.config?.address || '',
            labelPrinterPort: labelPrinterRow?.config?.port || '9100',
            labelPrinterConnection: labelPrinterRow?.config?.connection || '',
            scaleConnection: scale?.config?.connection || '',
            scaleAddress: scale?.config?.address || '',
            scaleSerialPort: scale?.config?.serialPort || '',
            scaleUnit: scale?.config?.unit || 'lb',
            registerAddress,
            registerConnection,
            registerSerial,
            registerDriver: register?.config?.catalogModelId
                ? findModel(register.config.catalogModelId)?.driver || ''
                : ''
        }
    };
}

function summarizeEquipment(row, extra = {}) {
    if (!row) return null;
    const modelDef = row.config?.catalogModelId ? findModel(row.config.catalogModelId) : null;
    return {
        id: row.id,
        label: row.label,
        equipmentType: row.equipmentType,
        manufacturer: row.manufacturer || modelDef?.brandLabel || '',
        model: row.model || modelDef?.label || '',
        catalogModelId: row.config?.catalogModelId || '',
        serialNumber: row.serialNumber || '',
        config: row.config || {},
        ...extra
    };
}

module.exports = {
    buildRegisterHardwareProfile,
    resolvePoiDeviceId,
    resolvePrinterDriver
};
