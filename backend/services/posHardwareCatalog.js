'use strict';

/**
 * Open POS hardware catalog — processor-neutral, non-exclusive devices only.
 * Excludes ecosystems locked to one vendor (Square, Clover, Toast, NCR, HP Engage, etc.).
 *
 * config.catalogModelId is stored on each equipment row and drives validation
 * and runtime driver selection.
 */

const FIELD = {
    connectionUsbNetwork: {
        key: 'connection',
        label: 'Connection',
        type: 'select',
        options: [
            { value: 'usb', label: 'USB' },
            { value: 'network', label: 'Network (Ethernet / Wi‑Fi)' },
            { value: 'bluetooth', label: 'Bluetooth' }
        ],
        default: 'usb'
    },
    networkAddress: {
        key: 'address',
        label: 'IP address or hostname',
        type: 'text',
        placeholder: '192.168.1.50',
        required: false,
        requiredWhen: { field: 'connection', in: ['network', 'ethernet', 'wifi'] },
        showWhen: { field: 'connection', in: ['network', 'ethernet', 'wifi'] },
        help: 'LAN address used to reach this device for printing, display, or diagnostics.'
    },
    networkPort: {
        key: 'port',
        label: 'Network port',
        type: 'text',
        placeholder: '9100',
        required: false,
        showWhen: { field: 'connection', in: ['network', 'ethernet', 'wifi'] },
        help: 'Raw socket port (default 9100 for most receipt/label printers).'
    },
    paperWidth: {
        key: 'paperWidth',
        label: 'Paper width',
        type: 'select',
        options: [
            { value: '58', label: '58 mm' },
            { value: '80', label: '80 mm' }
        ],
        default: '80'
    },
    poiDeviceId: {
        key: 'poiDeviceId',
        label: 'NMI POI device ID',
        type: 'text',
        placeholder: 'From NMI device list',
        required: true,
        help: 'Required for semi-integrated card sales on this terminal.'
    },
    paypointAddress: {
        key: 'address',
        label: 'Device IP or hostname',
        type: 'text',
        placeholder: '192.168.1.100',
        required: true,
        help:
            'LAN address of this unit — customer display browser, remote support, and network diagnostics. Find in device network settings or your router.'
    },
    terminalLanAddress: {
        key: 'address',
        label: 'Terminal IP or hostname',
        type: 'text',
        placeholder: '192.168.1.51',
        required: false,
        requiredWhen: { field: 'connection', in: ['ethernet', 'wifi', 'network'] },
        showWhen: { field: 'connection', in: ['ethernet', 'wifi', 'network'] },
        help: 'Required when the terminal is on Ethernet or Wi‑Fi — used for local status and processor reachability.'
    },
    keyboardWedge: {
        key: 'connection',
        label: 'Connection',
        type: 'select',
        options: [
            { value: 'keyboard_wedge', label: 'Keyboard wedge (USB — no driver)' },
            { value: 'usb', label: 'USB serial' },
            { value: 'bluetooth', label: 'Bluetooth' }
        ],
        default: 'keyboard_wedge'
    },
    displayMode: {
        key: 'mode',
        label: 'Display mode',
        type: 'select',
        options: [
            { value: 'browser', label: 'Browser (second screen URL)' },
            { value: 'hdmi', label: 'HDMI secondary display' },
            { value: 'pole', label: 'Pole display' }
        ],
        default: 'browser'
    },
    displayUrl: {
        key: 'url',
        label: 'Customer display URL',
        type: 'text',
        placeholder: '/business-one-pos/display.html',
        required: false,
        requiredWhen: { field: 'mode', equals: 'browser' },
        showWhen: { field: 'mode', equals: 'browser' }
    },
    adPlaylistMode: {
        key: 'adPlaylistMode',
        label: 'Ad playlist',
        type: 'select',
        options: [
            { value: 'all', label: 'All active ads (Marketing library)' },
            { value: 'selected', label: 'Selected ads only (Marketing → Front-facing displays)' }
        ],
        default: 'all',
        help: 'Rotating promos when no sale is active. Pick specific ads under Marketing → Front-facing displays.'
    },
    linkedPrinter: {
        key: 'linkedPrinterEquipmentId',
        label: 'Opens through printer',
        type: 'equipment_link',
        filterType: 'receipt_printer',
        required: true,
        help: 'Cash drawer kick pulse is sent through the linked receipt printer.'
    },
    serialPort: {
        key: 'serialPort',
        label: 'COM port',
        type: 'text',
        placeholder: 'COM3',
        required: false,
        requiredWhen: { field: 'connection', in: ['serial'] },
        showWhen: { field: 'connection', in: ['serial'] }
    },
    hdmiDisplayIndex: {
        key: 'displayIndex',
        label: 'HDMI display index',
        type: 'text',
        placeholder: '1',
        required: false,
        showWhen: { field: 'mode', equals: 'hdmi' },
        help: 'OS display number for the customer screen (usually 1 for the second monitor).'
    },
    drawerKickMode: {
        key: 'kickMode',
        label: 'Drawer open signal',
        type: 'select',
        options: [
            { value: 'printer', label: 'Through linked receipt printer (RJ11)' },
            { value: 'network', label: 'Network drawer interface' }
        ],
        default: 'printer'
    }
};

function model(id, label, extra = {}) {
    const def = {
        id,
        label,
        driver: extra.driver || '',
        description: extra.description || '',
        configFields: extra.configFields || [],
        linkFields: extra.linkFields || [],
        defaults: extra.defaults || {}
    };
    if (extra.aioBuiltIn && Object.keys(extra.aioBuiltIn).length) {
        def.aioBuiltIn = { ...extra.aioBuiltIn };
    }
    return def;
}

/** Built-in peripheral catalog IDs per all-in-one platform family. */
const AIO_PLATFORM_BUILTIN = Object.freeze({
    paypoint_plus: {
        receiptPrinter: 'elo_paypoint_printer',
        customerDisplay: 'elo_paypoint_customer_display',
        cashDrawer: 'elo_paypoint_drawer',
        barcodeScanner: 'elo_paypoint_scanner'
    },
    paypoint_pro: {
        receiptPrinter: 'elo_paypoint_printer',
        customerDisplay: 'elo_paypoint_customer_display',
        cashDrawer: 'elo_paypoint_drawer',
        barcodeScanner: 'elo_paypoint_scanner'
    },
    sunmi: { receiptPrinter: 'sunmi_builtin_printer' },
    landi: { receiptPrinter: 'landi_builtin_printer' },
    aures: { receiptPrinter: 'aures_builtin_printer' },
    posiflex: { receiptPrinter: 'posiflex_builtin_printer' },
    partner: { receiptPrinter: 'partner_builtin_printer' }
});

function inferAioPlatformFromRegisterId(id) {
    const x = String(id || '').toLowerCase();
    if (x.includes('paypoint_pro')) return 'paypoint_pro';
    if (x.includes('paypoint')) return 'paypoint_plus';
    if (x.startsWith('sunmi_')) return 'sunmi';
    if (x.startsWith('landi_reg_')) return 'landi';
    if (x.startsWith('aures_')) return 'aures';
    if (x.startsWith('posiflex_')) return 'posiflex';
    if (x.startsWith('partner_')) return 'partner';
    return null;
}

function buildAioBuiltInForRegister(id, extra = {}) {
    if (extra.builtInPrinter === false && !extra.builtInCustomerDisplay) return {};
    const platform = extra.aioPlatform || inferAioPlatformFromRegisterId(id);
    if (!platform || !AIO_PLATFORM_BUILTIN[platform]) return {};

    const aioBuiltIn = {};
    if (extra.builtInPrinter !== false && AIO_PLATFORM_BUILTIN[platform].receiptPrinter) {
        aioBuiltIn.receiptPrinter = AIO_PLATFORM_BUILTIN[platform].receiptPrinter;
    }
    if (extra.builtInCustomerDisplay) {
        aioBuiltIn.customerDisplay = extra.builtInCustomerDisplay;
    } else if (extra.builtInCustomerDisplay !== false) {
        if (
            (platform === 'paypoint_plus' || platform === 'paypoint_pro') &&
            AIO_PLATFORM_BUILTIN[platform].customerDisplay
        ) {
            aioBuiltIn.customerDisplay = AIO_PLATFORM_BUILTIN[platform].customerDisplay;
        } else if (platform === 'sunmi' && /^sunmi_t2s|^sunmi_t3/.test(id)) {
            aioBuiltIn.customerDisplay = 'sunmi_builtin_customer_display';
        } else if (platform === 'landi' && /^landi_reg_(c20_pro|m20se|a9)/.test(id)) {
            aioBuiltIn.customerDisplay = 'landi_builtin_customer_display';
        }
    }
    if (AIO_PLATFORM_BUILTIN[platform].cashDrawer) {
        aioBuiltIn.cashDrawer = AIO_PLATFORM_BUILTIN[platform].cashDrawer;
    }
    if (AIO_PLATFORM_BUILTIN[platform].barcodeScanner) {
        aioBuiltIn.barcodeScanner = AIO_PLATFORM_BUILTIN[platform].barcodeScanner;
    }
    return aioBuiltIn;
}

const AIO_BUILTIN_CONN = {
    key: 'connection',
    label: 'Connection',
    type: 'select',
    options: [{ value: 'integrated', label: 'Built-in (same all-in-one unit)' }],
    default: 'integrated'
};

/** @deprecated alias */
const ELO_INTEGRATED_CONN = AIO_BUILTIN_CONN;

const PAYPOINT_DEPLOYMENT = {
    key: 'connection',
    label: 'POS deployment',
    type: 'select',
    options: [
        { value: 'integrated', label: 'POS runs on this PayPoint (same device)' },
        { value: 'network', label: 'POS on another PC — reach PayPoint over LAN' }
    ],
    default: 'integrated',
    help:
        'Integrated: Business One opens in the PayPoint browser — tie to a register using Assigned register + API key from Registers. Network: enter this unit’s IP below.'
};

/** Semi-integrated countertop terminal (PAX A3700 style). */
function nmiCountertop(id, label, description) {
    return model(id, label, {
        driver: 'nmi',
        description: description || 'Countertop semi-integrated terminal via NMI.',
        configFields: [
            FIELD.poiDeviceId,
            {
                key: 'connection',
                label: 'Connection',
                type: 'select',
                options: [
                    { value: 'semi_integrated', label: 'Semi-integrated (recommended)' },
                    { value: 'ethernet', label: 'Ethernet' },
                    { value: 'wifi', label: 'Wi‑Fi' }
                ],
                default: 'semi_integrated'
            },
            FIELD.terminalLanAddress
        ]
    });
}

/** Mobile / portable payment terminal. */
function nmiMobile(id, label, description) {
    return model(id, label, {
        driver: 'nmi',
        description: description || 'Portable terminal via NMI.',
        configFields: [FIELD.poiDeviceId, FIELD.connectionUsbNetwork, FIELD.networkAddress, FIELD.networkPort]
    });
}

function eloPayPoint(id, label, description) {
    const aioBuiltIn = buildAioBuiltInForRegister(id, { aioPlatform: 'paypoint_plus' });
    return model(id, label, {
        driver: 'elo_star',
        description,
        configFields: [PAYPOINT_DEPLOYMENT, FIELD.paypointAddress, FIELD.paperWidth],
        aioBuiltIn
    });
}

function eloPayPointPro(id, label, description) {
    const aioBuiltIn = buildAioBuiltInForRegister(id, { aioPlatform: 'paypoint_pro' });
    return model(id, label, {
        driver: 'elo_star',
        description,
        configFields: [PAYPOINT_DEPLOYMENT, FIELD.paypointAddress, FIELD.paperWidth],
        aioBuiltIn
    });
}

/** Windows / Linux PC or touch monitor running browser POS. */
function registerBrowser(id, label, description, extra = {}) {
    return model(id, label, {
        driver: extra.driver || 'browser',
        description,
        configFields: [FIELD.connectionUsbNetwork, FIELD.networkAddress],
        ...extra
    });
}

/** Android all-in-one SmartPOS (Sunmi, Landi, etc.). */
function androidAioRegister(id, label, description, extra = {}) {
    const fields = [PAYPOINT_DEPLOYMENT, FIELD.paypointAddress];
    const hasBuiltInPrinter = extra.builtInPrinter !== false;
    if (hasBuiltInPrinter) fields.push(FIELD.paperWidth);

    const { builtInPrinter, builtInCustomerDisplay, aioPlatform, ...restExtra } = extra;
    const aioBuiltIn = buildAioBuiltInForRegister(id, {
        builtInPrinter,
        builtInCustomerDisplay,
        aioPlatform
    });

    return model(id, label, {
        driver: 'browser',
        description,
        configFields: fields,
        ...(Object.keys(aioBuiltIn).length ? { aioBuiltIn } : {}),
        ...restExtra
    });
}

/** Fanless Windows / Linux all-in-one POS terminal (Posiflex, Partner Tech, Aures, etc.). */
function fanlessAioRegister(id, label, description, extra = {}) {
    const { builtInPrinter, builtInCustomerDisplay, aioPlatform, ...restExtra } = extra;
    const aioBuiltIn = buildAioBuiltInForRegister(id, {
        builtInPrinter,
        builtInCustomerDisplay,
        aioPlatform
    });
    return registerBrowser(id, label, description, {
        ...(Object.keys(aioBuiltIn).length ? { aioBuiltIn } : {}),
        ...restExtra
    });
}

/** @deprecated use registerBrowser — kept as alias */
function eloTouchBrowser(id, label, description, extra = {}) {
    return registerBrowser(id, label, description, extra);
}

function receiptPrinter(id, label, driver, description) {
    return model(id, label, {
        driver,
        description,
        configFields: [FIELD.connectionUsbNetwork, FIELD.networkAddress, FIELD.networkPort, FIELD.paperWidth]
    });
}

function scannerWedge(id, label, description) {
    return model(id, label, {
        description: description || 'USB keyboard-wedge — plug in and scan.',
        configFields: [FIELD.keyboardWedge]
    });
}

/** Built-in receipt printer on an all-in-one register (PayPoint, Sunmi, Landi, etc.). */
function aioBuiltinPrinter(id, peripheralLabel, driver, hostPlatform, description) {
    return model(id, peripheralLabel, {
        driver,
        description:
            description ||
            `Built-in ${peripheralLabel.toLowerCase()} on ${hostPlatform} — same physical unit as the register.`,
        configFields: [AIO_BUILTIN_CONN, FIELD.paperWidth]
    });
}

/** Built-in customer-facing screen on an all-in-one register. */
function aioBuiltinCustomerDisplay(id, peripheralLabel, hostPlatform, description) {
    return model(id, peripheralLabel, {
        description:
            description ||
            `Built-in ${peripheralLabel.toLowerCase()} on ${hostPlatform} — same physical unit as the register.`,
        configFields: [
            AIO_BUILTIN_CONN,
            {
                key: 'mode',
                label: 'Display mode',
                type: 'select',
                options: [{ value: 'browser', label: 'Built-in front-facing screen' }],
                default: 'browser'
            },
            FIELD.displayUrl,
            FIELD.adPlaylistMode
        ]
    });
}

/** @deprecated use aioBuiltinCustomerDisplay */
function paypointCustomerDisplay(id, label, description) {
    return aioBuiltinCustomerDisplay(id, label, 'PayPoint Plus', description);
}

/** Built-in cash drawer on an all-in-one register (PayPoint, etc.). */
function aioBuiltinCashDrawer(id, peripheralLabel, hostPlatform, description) {
    return model(id, peripheralLabel, {
        description:
            description ||
            `Built-in ${peripheralLabel.toLowerCase()} on ${hostPlatform} — same physical unit as the register.`,
        configFields: [AIO_BUILTIN_CONN]
    });
}

/** Built-in barcode scanner on an all-in-one register (PayPoint, etc.). */
function aioBuiltinBarcodeScanner(id, peripheralLabel, hostPlatform, description) {
    return model(id, peripheralLabel, {
        description:
            description ||
            `Built-in ${peripheralLabel.toLowerCase()} on ${hostPlatform} — same physical unit as the register.`,
        configFields: [AIO_BUILTIN_CONN, FIELD.keyboardWedge]
    });
}

function customerDisplay(id, label, extra = {}) {
    const displayHost = {
        key: 'address',
        label: 'Display device IP or hostname',
        type: 'text',
        placeholder: '192.168.1.60',
        required: false,
        requiredWhen: { field: 'mode', equals: 'browser' },
        showWhen: { field: 'mode', equals: 'browser' },
        help: 'Required for browser customer displays — host that opens the customer screen URL.'
    };
    return model(id, label, {
        configFields: [FIELD.displayMode, displayHost, FIELD.displayUrl, FIELD.hdmiDisplayIndex, FIELD.adPlaylistMode],
        ...extra
    });
}

function poleDisplay(id, label, description) {
    return model(id, label, {
        description,
        configFields: [
            {
                key: 'mode',
                label: 'Display mode',
                type: 'select',
                options: [{ value: 'pole', label: 'Pole display' }],
                default: 'pole'
            },
            {
                key: 'connection',
                label: 'Connection',
                type: 'select',
                options: [
                    { value: 'serial', label: 'Serial (RS-232)' },
                    { value: 'usb', label: 'USB' }
                ],
                default: 'serial'
            },
            FIELD.serialPort
        ]
    });
}

function drawerViaPrinter(id, label, description) {
    return model(id, label, {
        description,
        configFields: [FIELD.linkedPrinter],
        linkFields: [FIELD.linkedPrinter]
    });
}

function drawerNetPro(id, label, description) {
    return model(id, label, {
        description,
        configFields: [
            FIELD.drawerKickMode,
            {
                ...FIELD.linkedPrinter,
                required: false,
                requiredWhen: { field: 'kickMode', equals: 'printer' },
                showWhen: { field: 'kickMode', equals: 'printer' }
            },
            {
                ...FIELD.networkAddress,
                label: 'Drawer interface IP or hostname',
                requiredWhen: { field: 'kickMode', equals: 'network' },
                showWhen: { field: 'kickMode', equals: 'network' }
            }
        ],
        linkFields: [FIELD.linkedPrinter]
    });
}

function labelPrinter(id, label, driver, description) {
    return model(id, label, {
        driver,
        description,
        configFields: [FIELD.connectionUsbNetwork, FIELD.networkAddress, FIELD.networkPort]
    });
}

const CATALOG_BY_TYPE = Object.freeze({
    register: {
        brands: {
            elo: {
                label: 'Elo Touch Solutions',
                models: {
                    paypoint_plus_15: eloPayPoint(
                        'elo_paypoint_plus_15',
                        'PayPoint Plus 15"',
                        'Current-gen all-in-one Android register with built-in printer.'
                    ),
                    paypoint_plus_22: eloPayPoint(
                        'elo_paypoint_plus_22',
                        'PayPoint Plus 22"',
                        'Large-format PayPoint with integrated printer.'
                    ),
                    paypoint_android_15: eloPayPoint(
                        'elo_paypoint_android_15',
                        'PayPoint for Android 15"',
                        'PayPoint platform running Android POS apps.'
                    ),
                    paypoint_android_22: eloPayPoint(
                        'elo_paypoint_android_22',
                        'PayPoint for Android 22"',
                        '22" PayPoint for Android with integrated printer.'
                    ),
                    isc_15: eloTouchBrowser(
                        'elo_isc_15',
                        'ISC 15"',
                        'Compact open-frame / kiosk touchscreen — attach peripherals.'
                    ),
                    isc_22: eloTouchBrowser('elo_isc_22', 'ISC 22"', '22" ISC touchscreen for POS builds.'),
                    iseries4_15: eloTouchBrowser(
                        'elo_iseries4_15',
                        'I-Series 4 15"',
                        'Current I-Series touchscreen — common retail register display.'
                    ),
                    iseries4_17: eloTouchBrowser('elo_iseries4_17', 'I-Series 4 17"', '17" I-Series 4 touch display.'),
                    iseries4_22: eloTouchBrowser('elo_iseries4_22', 'I-Series 4 22"', '22" I-Series 4 touch display.'),
                    iseries3_15: eloTouchBrowser('elo_iseries3_15', 'I-Series 3 15"', 'Previous-gen I-Series still widely deployed.'),
                    iseries3_22: eloTouchBrowser('elo_iseries3_22', 'I-Series 3 22"', '22" I-Series 3 touch display.'),
                    iseries2_15: eloTouchBrowser('elo_iseries2_15', 'I-Series 2 15"', 'Legacy I-Series 2 — still in many stores.'),
                    m50: eloTouchBrowser('elo_m50', 'M50 Mobile POS', 'Elo mobile tablet for line-busting / mobile checkout.'),
                    m60: eloTouchBrowser('elo_m60', 'M60 Mobile POS', 'Rugged Elo mobile POS tablet.'),
                    pos_pad_15: eloTouchBrowser('elo_pos_pad_15', 'POS Pad 15"', 'Tablet-style Elo register display.'),
                    backlite_15: eloTouchBrowser(
                        'elo_backlite_15',
                        'BackLite 15"',
                        'Rear-customer-facing capable 15" Elo display.'
                    ),
                    backlite_17: eloTouchBrowser('elo_backlite_17', 'BackLite 17"', '17" BackLite touch display.'),
                    iseries5_15: eloTouchBrowser(
                        'elo_iseries5_15',
                        'I-Series 5 15"',
                        'Current-generation I-Series 5 — common new retail deployments.'
                    ),
                    iseries5_17: eloTouchBrowser('elo_iseries5_17', 'I-Series 5 17"', '17" I-Series 5 touch display.'),
                    iseries5_22: eloTouchBrowser('elo_iseries5_22', 'I-Series 5 22"', '22" I-Series 5 touch display.'),
                    paypoint_15ii: eloPayPoint(
                        'elo_paypoint_15ii',
                        'PayPoint Plus 15" II',
                        'Second-generation PayPoint Plus 15" with integrated printer.'
                    ),
                    paypoint_22ii: eloPayPoint(
                        'elo_paypoint_22ii',
                        'PayPoint Plus 22" II',
                        'Second-generation PayPoint Plus 22" with integrated printer.'
                    ),
                    paypoint_pro_13: eloPayPointPro(
                        'elo_paypoint_pro_13',
                        'PayPoint Pro 13"',
                        'Legacy Windows PayPoint Pro — integrated printer, scanner, drawer, and customer display.'
                    ),
                    paypoint_pro_15: eloPayPointPro(
                        'elo_paypoint_pro_15',
                        'PayPoint Pro 15"',
                        'PayPoint Pro all-in-one with integrated peripherals for open POS software.'
                    ),
                    x15: eloTouchBrowser('elo_x15', 'X-Series 15"', 'X-Series open-frame touch monitor for POS builds.'),
                    x17: eloTouchBrowser('elo_x17', 'X-Series 17"', '17" X-Series touch display.'),
                    x22: eloTouchBrowser('elo_x22', 'X-Series 22"', '22" X-Series touch display.'),
                    '2494l': eloTouchBrowser('elo_2494l', '2494L 24"', '24" Elo touch monitor — counter register display.'),
                    '2201l': eloTouchBrowser('elo_2201l', '2201L 22"', '22" Elo 2201L touch display.'),
                    pos_stand_15: eloTouchBrowser('elo_pos_stand_15', 'POS Stand 15"', 'Elo POS stand with 15" display.'),
                    pos_stand_22: eloTouchBrowser('elo_pos_stand_22', 'POS Stand 22"', 'Elo POS stand with 22" display.'),
                    et1004l: eloTouchBrowser('elo_et1004l', 'ET1004L 10"', '10" Elo tablet-style touch display.')
                }
            },
            landi: {
                label: 'Landi',
                models: {
                    m20se: androidAioRegister(
                        'landi_reg_m20se',
                        'M20SE SmartPOS',
                        'Landi Android SmartPOS often used as the main register with browser POS.'
                    ),
                    m20: androidAioRegister('landi_reg_m20', 'M20 SmartPOS', 'Landi M20 Android all-in-one.'),
                    a9: androidAioRegister('landi_reg_a9', 'A9 SmartPOS', 'Current Landi A9 flagship Android device.'),
                    a8: androidAioRegister('landi_reg_a8', 'A8 SmartPOS', 'Landi A8 Android SmartPOS.'),
                    c20_pro: androidAioRegister(
                        'landi_reg_c20_pro',
                        'C20 Pro AIO',
                        'Landi C20 Pro countertop Android — register + payment in one.'
                    ),
                    n950s: androidAioRegister('landi_reg_n950s', 'N950S', 'Landi N950S Android payment terminal used as mobile register.', {
                        builtInPrinter: false
                    })
                }
            },
            sunmi: {
                label: 'Sunmi',
                models: {
                    t2: androidAioRegister('sunmi_t2', 'T2', '15.6" Sunmi Android POS — very common open-stack register.'),
                    t2s: androidAioRegister('sunmi_t2s', 'T2s', 'T2s with upgraded specs and dual display option.'),
                    t2s_lite: androidAioRegister('sunmi_t2s_lite', 'T2s Lite', 'Budget Sunmi T2s Lite countertop POS.'),
                    t3: androidAioRegister('sunmi_t3', 'T3', 'Current Sunmi T3 generation Android POS.'),
                    d3_pro: androidAioRegister('sunmi_d3_pro', 'D3 Pro', 'Sunmi D3 Pro with built-in printer.'),
                    d2s: androidAioRegister('sunmi_d2s', 'D2s', 'Compact Sunmi D2s Android POS.'),
                    k2: androidAioRegister('sunmi_k2', 'K2', 'Sunmi K2 mini Android POS.', { builtInPrinter: false }),
                    v2s: androidAioRegister('sunmi_v2s', 'V2s', 'Sunmi V2s value-line Android register.')
                }
            },
            posiflex: {
                label: 'Posiflex',
                models: {
                    xt4015: fanlessAioRegister(
                        'posiflex_xt4015',
                        'XT-4015',
                        '15" fanless Posiflex all-in-one — common independent retail.',
                        { aioPlatform: 'posiflex' }
                    ),
                    xt6015: fanlessAioRegister(
                        'posiflex_xt6015',
                        'XT-6015',
                        '15" Posiflex terminal with optional MSR.',
                        { aioPlatform: 'posiflex' }
                    ),
                    hs3510: eloTouchBrowser('posiflex_hs3510', 'HS-3510', 'Compact 10" Posiflex touchscreen.'),
                    xt3215: fanlessAioRegister(
                        'posiflex_xt3215',
                        'XT-3215',
                        '15" Posiflex XT-3215 fanless terminal.',
                        { aioPlatform: 'posiflex' }
                    ),
                    ks7215: fanlessAioRegister(
                        'posiflex_ks7215',
                        'KS-7215',
                        '15" Posiflex KS series kiosk / POS.',
                        { aioPlatform: 'posiflex' }
                    ),
                    mp3006: eloTouchBrowser('posiflex_mp3006', 'MP-3006', 'Posiflex MP-3006 modular POS.')
                }
            },
            dell: {
                label: 'Dell',
                models: {
                    optiplex_aio: eloTouchBrowser(
                        'dell_optiplex_aio',
                        'OptiPlex All-in-One',
                        'Dell OptiPlex AIO running browser POS.'
                    ),
                    optiplex_micro: eloTouchBrowser(
                        'dell_optiplex_micro',
                        'OptiPlex Micro + monitor',
                        'Small-form-factor Dell with separate touch display.'
                    )
                }
            },
            lenovo: {
                label: 'Lenovo',
                models: {
                    thinkcentre_aio: eloTouchBrowser(
                        'lenovo_thinkcentre_aio',
                        'ThinkCentre AIO',
                        'Lenovo ThinkCentre all-in-one for retail POS.'
                    ),
                    thinkcentre_tiny: eloTouchBrowser(
                        'lenovo_thinkcentre_tiny',
                        'ThinkCentre Tiny',
                        'Compact Lenovo PC with touch monitor.'
                    )
                }
            },
            partner: {
                label: 'Partner Tech',
                models: {
                    pt8900: fanlessAioRegister(
                        'partner_pt8900',
                        'PT-8900',
                        'Partner Tech 15" POS terminal.',
                        { aioPlatform: 'partner' }
                    ),
                    sp631: eloTouchBrowser('partner_sp631', 'SP-631', 'Compact Partner Tech touchscreen POS.'),
                    pt6200: fanlessAioRegister(
                        'partner_pt6200',
                        'PT-6200',
                        'Partner Tech PT-6200 POS terminal.',
                        { aioPlatform: 'partner' }
                    ),
                    rp330: fanlessAioRegister(
                        'partner_rp330',
                        'RP-330',
                        'Partner Tech RP-330 receipt printer combo base.',
                        { aioPlatform: 'partner' }
                    )
                }
            },
            aures: {
                label: 'Aures',
                models: {
                    yuno: androidAioRegister('aures_yuno', 'YUNO', 'Aures YUNO compact Android POS.'),
                    odyss: fanlessAioRegister(
                        'aures_odyss',
                        'ODYSS II',
                        'Aures ODYSS II touchscreen register.',
                        { aioPlatform: 'aures' }
                    ),
                    k18: fanlessAioRegister('aures_k18', 'K18', 'Aures K18 fanless POS terminal.', { aioPlatform: 'aures' })
                }
            },
            generic: {
                label: 'Generic / BYOD',
                models: {
                    windows_pc: eloTouchBrowser('generic_windows_pc', 'Windows PC', 'Desktop or mini PC running the POS in a browser.'),
                    windows_tablet: eloTouchBrowser(
                        'generic_windows_tablet',
                        'Windows tablet',
                        'Surface or rugged Windows tablet.'
                    ),
                    android_tablet: eloTouchBrowser('generic_android_tablet', 'Android tablet', 'Samsung or commercial Android tablet.'),
                    ipad: model('generic_ipad', 'iPad', {
                        driver: 'browser',
                        description: 'iPad running Business One in Safari — network connection required.',
                        configFields: [
                            {
                                key: 'connection',
                                label: 'Connection',
                                type: 'select',
                                options: [{ value: 'network', label: 'Network (Wi‑Fi)' }],
                                default: 'network'
                            },
                            {
                                ...FIELD.paypointAddress,
                                label: 'iPad IP or hostname',
                                help: 'LAN address of the iPad for display sync and support.'
                            }
                        ]
                    })
                }
            }
        }
    },
    card_terminal: {
        brands: {
            pax: {
                label: 'PAX',
                models: {
                    a3700: nmiCountertop('pax_a3700', 'A3700', 'Countertop Android — common NMI semi-integrated terminal.'),
                    a920: nmiMobile('pax_a920', 'A920', 'Popular Android mobile terminal.'),
                    a920_pro: nmiMobile('pax_a920_pro', 'A920 Pro', 'A920 Pro with larger display.'),
                    a920_max: nmiMobile('pax_a920_max', 'A920 Max', 'Large-screen A920 Max.'),
                    a77: nmiMobile('pax_a77', 'A77', 'Compact Android SmartMobile terminal.'),
                    a80: nmiMobile('pax_a80', 'A80', 'Countertop Android terminal.'),
                    a35: nmiMobile('pax_a35', 'A35', 'Entry-level Android mobile terminal.'),
                    a6650: nmiMobile('pax_a6650', 'A6650', 'Large display countertop terminal.'),
                    s300: nmiCountertop('pax_s300', 'S300', 'Countertop payment terminal.'),
                    im30: nmiCountertop('pax_im30', 'IM30', 'Unattended / kiosk payment module.'),
                    e600mini: nmiCountertop('pax_e600mini', 'E600Mini', 'Compact unattended terminal.'),
                    a800: nmiCountertop('pax_a800', 'A800', 'Android countertop terminal.'),
                    a50: nmiMobile('pax_a50', 'A50', 'Compact Android mobile terminal.'),
                    a30: nmiMobile('pax_a30', 'A30', 'Entry-level PAX mobile terminal.'),
                    a8700: nmiCountertop('pax_a8700', 'A8700', 'Large display Android countertop.'),
                    a6650_2: nmiCountertop('pax_a6650_2', 'A6650 II', 'Second-generation A6650 countertop.')
                }
            },
            landi: {
                label: 'Landi',
                models: {
                    m20se: nmiMobile('landi_m20se', 'M20SE', 'Landi Android SmartPOS — very common processor-neutral deployment.'),
                    m20: nmiMobile('landi_m20', 'M20', 'Landi M20 Android terminal.'),
                    e355: nmiMobile('landi_e355', 'E355', 'Landi E355 Android terminal.'),
                    e360: nmiMobile('landi_e360', 'E360', 'Landi E360 with physical keypad.'),
                    e520: nmiMobile('landi_e520', 'E520', '5" display Landi portable terminal.'),
                    e585: nmiMobile('landi_e585', 'E585', '5.5" Landi terminal — recent generation.'),
                    c20_pro: nmiMobile('landi_c20_pro', 'C20 Pro', 'Landi C20 Pro countertop.'),
                    a8: nmiMobile('landi_a8', 'A8', 'Landi A8 SmartPOS.'),
                    a9: nmiMobile('landi_a9', 'A9', 'Landi A9 — current Landi flagship mobile.'),
                    n950s: nmiMobile('landi_n950s', 'N950S', 'Landi N950S Android payment device.'),
                    dx4000: nmiCountertop('landi_dx4000', 'DX4000', 'Landi DX4000 countertop (Ingenico-group platform).')
                }
            },
            ingenico: {
                label: 'Ingenico (Worldline)',
                models: {
                    lane_3000: nmiCountertop('ingenico_lane_3000', 'Lane/3000', 'Countertop Lane series.'),
                    lane_3600: nmiCountertop('ingenico_lane_3600', 'Lane/3600', 'Lane/3600 with color display.'),
                    lane_5000: nmiCountertop('ingenico_lane_5000', 'Lane/5000', '5" Lane countertop terminal.'),
                    lane_7000: nmiCountertop('ingenico_lane_7000', 'Lane/7000', '7" Lane countertop terminal.'),
                    desk_3500: nmiCountertop('ingenico_desk_3500', 'Desk/3500', 'Desk countertop terminal.'),
                    move_3500: nmiMobile('ingenico_move_3500', 'Move/3500', 'Portable Move/3500.'),
                    move_5000: nmiMobile('ingenico_move_5000', 'Move/5000', 'Move/5000 portable terminal.'),
                    link_2500: nmiMobile('ingenico_link_2500', 'Link/2500', 'Link/2500 mobile terminal.'),
                    dx8000: nmiCountertop('ingenico_dx8000', 'DX8000', 'Android DX8000 countertop — current Worldline flagship.'),
                    dx4000: nmiCountertop('ingenico_dx4000', 'DX4000', 'DX4000 Android countertop terminal.'),
                    axium_dx8000: nmiCountertop('ingenico_axium_dx8000', 'Axium DX8000', 'Axium-branded DX8000 deployment.'),
                    move_5000f: nmiMobile('ingenico_move_5000f', 'Move/5000F', 'Move/5000F portable with contactless.')
                }
            },
            verifone: {
                label: 'Verifone',
                models: {
                    v200c: nmiCountertop('verifone_v200c', 'V200c', 'Countertop V200c — widely deployed.'),
                    v400c: nmiCountertop('verifone_v400c', 'V400c', 'Verifone V400c countertop.'),
                    v400m: nmiMobile('verifone_v400m', 'V400m', 'Portable V400m terminal.'),
                    t650p: nmiCountertop('verifone_t650p', 'T650p', 'Android T650p countertop.'),
                    p400: nmiCountertop('verifone_p400', 'P400', 'Compact P400 PIN pad / terminal.'),
                    m400: nmiMobile('verifone_m400', 'M400', 'Mobile M400 terminal.'),
                    t640: nmiCountertop('verifone_t640', 'T640', 'Android T640 countertop terminal.'),
                    t650c: nmiCountertop('verifone_t650c', 'T650c', 'T650c compact Android countertop.'),
                    vx690: nmiMobile('verifone_vx690', 'VX690', 'Verifone VX690 portable terminal.')
                }
            },
            dejavoo: {
                label: 'Dejavoo',
                models: {
                    z11: nmiCountertop('dejavoo_z11', 'Z11', 'Dejavoo Z11 countertop.'),
                    z6: nmiMobile('dejavoo_z6', 'Z6', 'Dejavoo Z6 mobile.'),
                    z1: nmiMobile('dejavoo_z1', 'Z1', 'Compact Z1 mobile terminal.'),
                    z3: nmiMobile('dejavoo_z3', 'Z3', 'Z3 Android terminal.'),
                    z8: nmiMobile('dejavoo_z8', 'Z8', 'Z8 with larger display.'),
                    z9: nmiMobile('dejavoo_z9', 'Z9', 'Current-gen Z9 Android terminal.'),
                    qd4: nmiMobile('dejavoo_qd4', 'QD4', 'Dejavoo QD4 portable.')
                }
            },
            castles: {
                label: 'Castles Technology',
                models: {
                    saturn1000: nmiCountertop('castles_saturn1000', 'Saturn 1000', 'Castles countertop terminal.'),
                    s1f2: nmiMobile('castles_s1f2', 'S1F2', 'Castles S1F2 mobile terminal.')
                }
            },
            sunmi: {
                label: 'Sunmi',
                models: {
                    p2: nmiMobile('sunmi_p2', 'P2', 'Sunmi P2 SmartPOS — popular with open POS stacks.'),
                    p2_pro: nmiMobile('sunmi_p2_pro', 'P2 Pro', 'Sunmi P2 Pro with larger display.'),
                    p3: nmiMobile('sunmi_p3', 'P3', 'Sunmi P3 current generation.'),
                    v2_pro: nmiMobile('sunmi_v2_pro', 'V2 Pro', 'Sunmi V2 Pro payment terminal.')
                }
            },
            idtech: {
                label: 'ID Tech',
                models: {
                    vp3350: nmiMobile('idtech_vp3350', 'VP3350', 'ID Tech VP3350 Bluetooth mobile reader.'),
                    apollo: nmiCountertop('idtech_apollo', 'Apollo', 'ID Tech Apollo countertop terminal.')
                }
            }
        }
    },
    receipt_printer: {
        brands: {
            star: {
                label: 'Star Micronics',
                models: {
                    tsp143iii: receiptPrinter(
                        'star_tsp143iii',
                        'TSP143III (USB / LAN)',
                        'star_network',
                        'Best-selling Star receipt printer — USB or Ethernet.'
                    ),
                    tsp143iv: receiptPrinter('star_tsp143iv', 'TSP143IV', 'star_network', 'Current TSP143IV generation.'),
                    tsp654ii: receiptPrinter('star_tsp654ii', 'TSP654II', 'star_network', 'High-speed  thermal printer.'),
                    tsp650ii: receiptPrinter('star_tsp650ii', 'TSP650II', 'star_network', 'Classic Star kitchen / receipt printer.'),
                    tsp100: receiptPrinter('star_tsp100', 'TSP100III', 'star_network', 'Compact TSP100 series.'),
                    mcp31: receiptPrinter('star_mcp31', 'mC-Print3', 'star_network', 'Star mC-Print3 — mPOS / tablet pairing.'),
                    mcp21: receiptPrinter('star_mcp21', 'mC-Print2', 'star_network', 'Compact mC-Print2 Bluetooth / USB.'),
                    sp742: receiptPrinter('star_sp742', 'SP742 (impact)', 'star_network', 'Kitchen impact printer for multi-copy tickets.'),
                    tsp847ii: receiptPrinter('star_tsp847ii', 'TSP847II', 'star_network', 'High-speed Star TSP847II receipt printer.')
                }
            },
            paypoint_plus_builtin: {
                label: 'PayPoint · Built-in',
                models: {
                    receipt_printer: aioBuiltinPrinter(
                        'elo_paypoint_printer',
                        'Receipt printer',
                        'elo_star',
                        'PayPoint',
                        'Integrated Star printer inside PayPoint — same unit as the register.'
                    )
                }
            },
            sunmi_builtin: {
                label: 'Sunmi · Built-in',
                models: {
                    receipt_printer: aioBuiltinPrinter(
                        'sunmi_builtin_printer',
                        'Receipt printer',
                        'escpos_network',
                        'Sunmi Android POS',
                        'Integrated thermal printer on Sunmi T2, T2s, T3, D3 Pro, and similar units.'
                    )
                }
            },
            landi_builtin: {
                label: 'Landi · Built-in',
                models: {
                    receipt_printer: aioBuiltinPrinter(
                        'landi_builtin_printer',
                        'Receipt printer',
                        'escpos_network',
                        'Landi SmartPOS',
                        'Integrated thermal printer on Landi M20, A8, A9, and similar Android all-in-ones.'
                    )
                }
            },
            aures_builtin: {
                label: 'Aures · Built-in',
                models: {
                    receipt_printer: aioBuiltinPrinter(
                        'aures_builtin_printer',
                        'Receipt printer',
                        'escpos_network',
                        'Aures all-in-one',
                        'Integrated thermal printer on Aures YUNO, ODYSS II, K18, and similar units.'
                    )
                }
            },
            posiflex_builtin: {
                label: 'Posiflex · Built-in',
                models: {
                    receipt_printer: aioBuiltinPrinter(
                        'posiflex_builtin_printer',
                        'Receipt printer',
                        'escpos_network',
                        'Posiflex all-in-one',
                        'Integrated thermal printer on Posiflex XT, KS, and similar fanless terminals.'
                    )
                }
            },
            partner_builtin: {
                label: 'Partner Tech · Built-in',
                models: {
                    receipt_printer: aioBuiltinPrinter(
                        'partner_builtin_printer',
                        'Receipt printer',
                        'escpos_network',
                        'Partner Tech all-in-one',
                        'Integrated thermal printer on Partner Tech PT and RP series terminals.'
                    )
                }
            },
            epson: {
                label: 'Epson',
                models: {
                    tm_t88vii: receiptPrinter('epson_tm_t88vii', 'TM-T88VII', 'escpos_network', 'Current TM-T88VII — industry standard.'),
                    tm_t88vi: receiptPrinter('epson_tm_t88vi', 'TM-T88VI', 'escpos_network', 'TM-T88VI — still very common in stores.'),
                    tm_m30iii: receiptPrinter('epson_tm_m30iii', 'TM-m30III', 'escpos_network', 'Compact TM-m30III for small counters.'),
                    tm_m30: receiptPrinter('epson_tm_m30', 'TM-m30II', 'escpos_network', 'Previous TM-m30 generation.'),
                    tm_t20iii: receiptPrinter('epson_tm_t20iii', 'TM-T20III', 'escpos_network', 'Entry-level Epson thermal receipt printer.'),
                    tm_l100: receiptPrinter('epson_tm_l100', 'TM-L100', 'escpos_network', 'Liner-free label / receipt hybrid.')
                }
            },
            bixolon: {
                label: 'Bixolon',
                models: {
                    srp350iii: receiptPrinter('bixolon_srp350iii', 'SRP-350plusIII', 'escpos_network', 'Popular Bixolon receipt printer.'),
                    srp275iii: receiptPrinter('bixolon_srp275iii', 'SRP-275III (impact)', 'escpos_network', 'Kitchen impact printer.'),
                    srpq300: receiptPrinter('bixolon_srpq300', 'SRP-Q300', 'escpos_network', 'Compact cube receipt printer.')
                }
            },
            citizen: {
                label: 'Citizen',
                models: {
                    cts310ii: receiptPrinter('citizen_cts310ii', 'CT-S310II', 'escpos_network', 'Compact Citizen thermal printer.'),
                    cts651ii: receiptPrinter('citizen_cts651ii', 'CT-S651II', 'escpos_network', 'High-speed Citizen receipt printer.')
                }
            },
            sam4s: {
                label: 'Sam4s',
                models: {
                    sps340: receiptPrinter('sam4s_sps340', 'SPS-340', 'escpos_network', 'Sam4s SPS-340 — common independent retail printer.'),
                    sps350: receiptPrinter('sam4s_sps350', 'SPS-350', 'escpos_network', 'Sam4s SPS-350 thermal receipt printer.'),
                    giant100: receiptPrinter('sam4s_giant100', 'Giant-100', 'escpos_network', 'Sam4s Giant-100 high-speed kitchen printer.')
                }
            },
            hp: {
                label: 'HP',
                models: {
                    value_rw420: receiptPrinter('hp_value_rw420', 'Value RW420', 'escpos_network', 'HP Value thermal receipt printer.')
                }
            }
        }
    },
    barcode_scanner: {
        brands: {
            paypoint_plus_builtin: {
                label: 'PayPoint · Built-in',
                models: {
                    barcode_scanner: aioBuiltinBarcodeScanner(
                        'elo_paypoint_scanner',
                        'Barcode scanner',
                        'PayPoint',
                        'Integrated Honeywell 2D imager inside PayPoint — same unit as the register.'
                    )
                }
            },
            zebra: {
                label: 'Zebra',
                models: {
                    ds2208: scannerWedge('zebra_ds2208', 'DS2208', 'Budget 1D/2D imager — very common at checkout.'),
                    ds4608: scannerWedge('zebra_ds4608', 'DS4608', '2D imager for dense / damaged barcodes.'),
                    ds8108: scannerWedge('zebra_ds8108', 'DS8108', 'High-performance 2D checkout scanner.'),
                    li4278: scannerWedge('zebra_li4278', 'LI4278', 'Cordless 1D linear imager with cradle.'),
                    cs4070: scannerWedge('zebra_cs4070', 'CS4070', 'Pocket cordless 1D/2D scanner.'),
                    ls2208: scannerWedge('zebra_ls2208', 'LS2208 (legacy)', 'Legacy 1D laser — still in many stores.')
                }
            },
            honeywell: {
                label: 'Honeywell',
                models: {
                    voyager_1200g: scannerWedge('honeywell_voyager_1200g', 'Voyager 1200g', 'Classic 1D laser scanner.'),
                    voyager_1250g: scannerWedge('honeywell_voyager_1250g', 'Voyager 1250g', 'Upgraded Voyager 1D laser.'),
                    voyager_1450g: scannerWedge('honeywell_voyager_1450g', 'Voyager 1450g', '2D Voyager imager.'),
                    xenon_1900: scannerWedge('honeywell_xenon_1900', 'Xenon 1900', '2D Xenon performance imager.'),
                    granit_1911i: scannerWedge('honeywell_granit_1911i', 'Granit 1911i', 'Rugged industrial 2D scanner.'),
                    eclipse_5145: scannerWedge('honeywell_eclipse_5145', 'Eclipse 5145', 'Handheld 1D laser scanner.')
                }
            },
            datalogic: {
                label: 'Datalogic',
                models: {
                    quickscan_qd2430: scannerWedge('datalogic_qd2430', 'QuickScan QD2430', 'Popular 2D presentation / handheld.'),
                    gryphon_gd4500: scannerWedge('datalogic_gd4500', 'Gryphon GD4500', '2D Gryphon imager.'),
                    powerscan_pd9531: scannerWedge('datalogic_pd9531', 'PowerScan PD9531', 'Rugged cordless industrial scanner.')
                }
            },
            socket: {
                label: 'Socket Mobile',
                models: {
                    s700: scannerWedge('socket_s700', 'S700', 'Bluetooth 1D/2D scanner for tablets.'),
                    s740: scannerWedge('socket_s740', 'S740', 'Rugged Bluetooth scanner for mobile POS.'),
                    s720: scannerWedge('socket_s720', 'S720', 'Compact Socket Mobile Bluetooth scanner.')
                }
            },
            symbol: {
                label: 'Symbol (legacy)',
                models: {
                    ls2208: scannerWedge('symbol_ls2208', 'LS2208', 'Legacy Symbol 1D laser — still widely deployed.'),
                    ds6708: scannerWedge('symbol_ds6708', 'DS6708', 'Symbol DS6708 2D imager.')
                }
            },
            generic: {
                label: 'Generic',
                models: {
                    keyboard_wedge: scannerWedge('generic_scanner_wedge', 'USB keyboard-wedge scanner', 'Any USB scanner that types into the POS.')
                }
            }
        }
    },
    cash_drawer: {
        brands: {
            paypoint_plus_builtin: {
                label: 'PayPoint · Built-in',
                models: {
                    cash_drawer: aioBuiltinCashDrawer(
                        'elo_paypoint_drawer',
                        'Cash drawer',
                        'PayPoint',
                        'Integrated 16" cash drawer inside PayPoint — same unit as the register.'
                    )
                }
            },
            apg: {
                label: 'APG',
                models: {
                    vasario_1616: drawerViaPrinter('apg_vasario_1616', 'Vasario 1616', '16" Vasario — most common retail size.'),
                    vasario_1820: drawerViaPrinter('apg_vasario_1820', 'Vasario 1820', '18" Vasario cash drawer.'),
                    series_4000: drawerViaPrinter('apg_series_4000', 'Series 4000', 'APG Series 4000 heavy-duty drawer.'),
                    netpro: drawerNetPro('apg_netpro', 'NetPRO', 'APG NetPRO with network interface option.'),
                }
            },
            mmf: {
                label: 'MMF / POS-X',
                models: {
                    advantage: drawerViaPrinter('mmf_advantage', 'Advantage', 'MMF Advantage cash drawer series.'),
                    val_u_line: drawerViaPrinter('mmf_val_u', 'Val-U Line', 'Value-line MMF drawer — printer kick.')
                }
            },
            star: {
                label: 'Star (printer-driven)',
                models: {
                    printer_kick: drawerViaPrinter('star_drawer_kick', 'Drawer kick via Star printer', 'RJ11 drawer connected to Star printer kick port.')
                }
            },
            hp: {
                label: 'HP',
                models: {
                    standard_duty: drawerViaPrinter('hp_drawer_standard', 'HP Standard Duty', 'HP-branded printer-driven drawer.')
                }
            },
            generic: {
                label: 'Generic',
                models: {
                    rj11_printer: drawerViaPrinter('generic_drawer_rj11', 'RJ11 printer-driven drawer', 'Standard RJ11 cash drawer kicked from receipt printer.')
                }
            }
        }
    },
    customer_display: {
        brands: {
            paypoint_plus_builtin: {
                label: 'PayPoint · Built-in',
                models: {
                    customer_display: aioBuiltinCustomerDisplay(
                        'elo_paypoint_customer_display',
                        'Customer display',
                        'PayPoint',
                        'Built-in front-facing screen on PayPoint — faces the customer at checkout.'
                    )
                }
            },
            sunmi_builtin: {
                label: 'Sunmi · Built-in',
                models: {
                    customer_display: aioBuiltinCustomerDisplay(
                        'sunmi_builtin_customer_display',
                        'Customer display',
                        'Sunmi Android POS',
                        'Built-in secondary customer-facing screen on Sunmi dual-display models (T2s, T3, etc.).'
                    )
                }
            },
            landi_builtin: {
                label: 'Landi · Built-in',
                models: {
                    customer_display: aioBuiltinCustomerDisplay(
                        'landi_builtin_customer_display',
                        'Customer display',
                        'Landi SmartPOS',
                        'Built-in customer-facing screen on Landi dual-display SmartPOS models.'
                    )
                }
            },
            elo: {
                label: 'Elo',
                models: {
                    iseries4_customer: customerDisplay('elo_iseries4_customer', 'I-Series 4 customer-facing'),
                    '1002l': customerDisplay('elo_1002l', '1002L 10"', {
                        description: '10" Elo customer / line display.'
                    }),
                    '0702l': customerDisplay('elo_0702l', '0702L 7"', {
                        description: 'Compact 7" Elo secondary display.'
                    }),
                    hdmi_secondary: customerDisplay('elo_customer_hdmi', 'HDMI secondary screen', {
                        configFields: [FIELD.displayMode, FIELD.hdmiDisplayIndex, FIELD.adPlaylistMode]
                    })
                }
            },
            logiccontrols: {
                label: 'Logic Controls',
                models: {
                    ld9000: poleDisplay('logiccontrols_ld9000', 'LD9000 pole display', 'Logic Controls LD9000 serial pole display.'),
                    leo1000: poleDisplay('logiccontrols_leo1000', 'LEO1000 pole', 'Logic Controls LEO1000 pole display.')
                }
            },
            posiflex: {
                label: 'Posiflex',
                models: {
                    pd3207: poleDisplay('posiflex_pd3207', 'PD3207 pole display', 'Posiflex PD3207 pole display.')
                }
            },
            generic: {
                label: 'Generic',
                models: {
                    browser_display: customerDisplay('generic_customer_browser', 'Browser customer display'),
                    hdmi_monitor: customerDisplay('generic_hdmi_monitor', 'HDMI monitor', {
                        configFields: [FIELD.displayMode, FIELD.hdmiDisplayIndex, FIELD.adPlaylistMode]
                    })
                }
            }
        }
    },
    label_printer: {
        brands: {
            zebra: {
                label: 'Zebra',
                models: {
                    zd421: labelPrinter('zebra_zd421', 'ZD421', 'zebra_label', 'Desktop ZD421 — USB or network.'),
                    zd411: labelPrinter('zebra_zd411', 'ZD411', 'zebra_label', 'Compact ZD411 label printer.'),
                    zd621: labelPrinter('zebra_zd621', 'ZD621', 'zebra_label', 'Industrial ZD621 label printer.'),
                    gc420d: labelPrinter('zebra_gc420d', 'GC420d (legacy)', 'zebra_label', 'Legacy GC420d label printer.')
                }
            },
            brother: {
                label: 'Brother',
                models: {
                    ql800: labelPrinter('brother_ql800', 'QL-800', 'brother_label', 'USB label printer — very common for shelf and product labels.'),
                    ql810w: labelPrinter('brother_ql810w', 'QL-810W', 'brother_label', 'QL-810W with Wi‑Fi — same QL series as the QL-800.'),
                    ql820nwb: labelPrinter('brother_ql820nwb', 'QL-820NWB', 'brother_label', 'Brother QL-820NWB network label printer.'),
                    ql1110nwb: labelPrinter('brother_ql1110', 'QL-1110NWB', 'brother_label', 'Wide-format Brother QL-1110NWB label printer.')
                }
            },
            dymo: {
                label: 'DYMO',
                models: {
                    labelwriter_4xl: labelPrinter('dymo_4xl', 'LabelWriter 4XL', 'browser', 'DYMO LabelWriter 4XL wide-format label printer.'),
                    labelwriter_550: labelPrinter('dymo_550', 'LabelWriter 550', 'browser', 'DYMO LabelWriter 550 USB / network label printer.')
                }
            }
        }
    },
    scale: {
        brands: {
            cas: {
                label: 'CAS',
                models: {
                    sw1: model('cas_sw1', 'SW-1', {
                        configFields: [
                            {
                                key: 'connection',
                                label: 'Connection',
                                type: 'select',
                                options: [
                                    { value: 'usb', label: 'USB' },
                                    { value: 'serial', label: 'Serial (RS-232)' },
                                    { value: 'network', label: 'Network' }
                                ],
                                default: 'usb'
                            },
                            FIELD.networkAddress,
                            FIELD.serialPort,
                            {
                                key: 'unit',
                                label: 'Unit',
                                type: 'select',
                                options: [
                                    { value: 'lb', label: 'Pounds (lb)' },
                                    { value: 'oz', label: 'Ounces (oz)' },
                                    { value: 'kg', label: 'Kilograms (kg)' },
                                    { value: 'g', label: 'Grams (g)' }
                                ],
                                default: 'lb'
                            }
                        ]
                    }),
                    er_jr: model('cas_er_jr', 'ER Jr', {
                        configFields: [
                            {
                                key: 'connection',
                                label: 'Connection',
                                type: 'select',
                                options: [
                                    { value: 'serial', label: 'Serial (RS-232)' },
                                    { value: 'usb', label: 'USB' }
                                ],
                                default: 'serial'
                            },
                            FIELD.serialPort,
                            {
                                key: 'unit',
                                label: 'Unit',
                                type: 'select',
                                options: [
                                    { value: 'lb', label: 'Pounds (lb)' },
                                    { value: 'kg', label: 'Kilograms (kg)' }
                                ],
                                default: 'lb'
                            }
                        ]
                    }),
                    pdii: model('cas_pdii', 'PD-II', {
                        configFields: [
                            {
                                key: 'connection',
                                label: 'Connection',
                                type: 'select',
                                options: [
                                    { value: 'serial', label: 'Serial (RS-232)' },
                                    { value: 'network', label: 'Network' }
                                ],
                                default: 'serial'
                            },
                            FIELD.networkAddress,
                            FIELD.serialPort,
                            {
                                key: 'unit',
                                label: 'Unit',
                                type: 'select',
                                options: [
                                    { value: 'lb', label: 'Pounds (lb)' },
                                    { value: 'kg', label: 'Kilograms (kg)' }
                                ],
                                default: 'lb'
                            }
                        ]
                    })
                }
            },
            mettler: {
                label: 'Mettler Toledo',
                models: {
                    bplus: model('mettler_bplus', 'BC / BPlus', {
                        configFields: [
                            {
                                key: 'connection',
                                label: 'Connection',
                                type: 'select',
                                options: [
                                    { value: 'usb', label: 'USB' },
                                    { value: 'serial', label: 'Serial' }
                                ],
                                default: 'usb'
                            },
                            FIELD.serialPort,
                            {
                                key: 'unit',
                                label: 'Unit',
                                type: 'select',
                                options: [
                                    { value: 'lb', label: 'Pounds (lb)' },
                                    { value: 'kg', label: 'Kilograms (kg)' }
                                ],
                                default: 'lb'
                            }
                        ]
                    }),
                    rl00: model('mettler_rl00', 'RL00', {
                        configFields: [
                            {
                                key: 'connection',
                                label: 'Connection',
                                type: 'select',
                                options: [
                                    { value: 'serial', label: 'Serial (RS-232)' },
                                    { value: 'usb', label: 'USB' }
                                ],
                                default: 'serial'
                            },
                            FIELD.serialPort,
                            {
                                key: 'unit',
                                label: 'Unit',
                                type: 'select',
                                options: [
                                    { value: 'lb', label: 'Pounds (lb)' },
                                    { value: 'kg', label: 'Kilograms (kg)' }
                                ],
                                default: 'lb'
                            }
                        ]
                    })
                }
            },
            avery: {
                label: 'Avery Berkel',
                models: {
                    fx120: model('avery_fx120', 'FX-120', {
                        configFields: [
                            {
                                key: 'connection',
                                label: 'Connection',
                                type: 'select',
                                options: [
                                    { value: 'serial', label: 'Serial (RS-232)' },
                                    { value: 'network', label: 'Network' }
                                ],
                                default: 'serial'
                            },
                            FIELD.networkAddress,
                            FIELD.serialPort,
                            {
                                key: 'unit',
                                label: 'Unit',
                                type: 'select',
                                options: [
                                    { value: 'lb', label: 'Pounds (lb)' },
                                    { value: 'kg', label: 'Kilograms (kg)' }
                                ],
                                default: 'lb'
                            }
                        ]
                    })
                }
            }
        }
    }
});

const EQUIPMENT_TYPE_META = Object.freeze({
    register: {
        id: 'register',
        label: 'POS register',
        description: 'The touchscreen or computer running Business One POS.',
        hasCatalog: false,
        manualConfigFields: [FIELD.connectionUsbNetwork, FIELD.networkAddress, FIELD.networkPort]
    },
    card_terminal: {
        id: 'card_terminal',
        label: 'Payment terminal',
        description: 'Countertop or mobile card reader for customer payments.',
        hasCatalog: false,
        manualConfigFields: [FIELD.poiDeviceId, FIELD.connectionUsbNetwork, FIELD.terminalLanAddress]
    },
    receipt_printer: {
        id: 'receipt_printer',
        label: 'Receipt printer',
        description: 'Thermal printer for customer receipts and drawer kick.',
        hasCatalog: false,
        manualConfigFields: [FIELD.connectionUsbNetwork, FIELD.networkAddress, FIELD.networkPort, FIELD.paperWidth]
    },
    barcode_scanner: {
        id: 'barcode_scanner',
        label: 'Barcode scanner',
        description: 'USB or Bluetooth scanner for SKU lookup.',
        hasCatalog: false,
        manualConfigFields: [FIELD.keyboardWedge]
    },
    cash_drawer: {
        id: 'cash_drawer',
        label: 'Cash drawer',
        description: 'Cash drawer opened via linked receipt printer or register.',
        hasCatalog: false,
        manualConfigFields: [FIELD.linkedPrinter]
    },
    customer_display: {
        id: 'customer_display',
        label: 'Customer display',
        description: 'Front-facing screen for cart totals and marketing ads. Assign ad playlists under Marketing → Front-facing displays.',
        hasCatalog: false,
        manualConfigFields: [FIELD.displayMode, FIELD.displayUrl, FIELD.adPlaylistMode, FIELD.networkAddress]
    },
    label_printer: {
        id: 'label_printer',
        label: 'Label printer',
        description: 'Shelf or product label printer.',
        hasCatalog: false,
        manualConfigFields: [FIELD.connectionUsbNetwork, FIELD.networkAddress, FIELD.networkPort]
    },
    scale: {
        id: 'scale',
        label: 'Scale',
        description: 'Weighing scale for bulk items.',
        hasCatalog: false,
        manualConfigFields: [
            FIELD.connectionUsbNetwork,
            FIELD.networkAddress,
            FIELD.serialPort,
            {
                key: 'unit',
                label: 'Unit',
                type: 'select',
                options: [
                    { value: 'lb', label: 'Pounds (lb)' },
                    { value: 'kg', label: 'Kilograms (kg)' }
                ],
                default: 'lb'
            }
        ]
    },
    other: {
        id: 'other',
        label: 'Other',
        description: 'Any other POS peripheral — enter manufacturer and model manually.',
        hasCatalog: false,
        manualConfigFields: [FIELD.connectionUsbNetwork, FIELD.networkAddress, FIELD.networkPort]
    }
});

function serializeConfigField(field) {
    if (!field) return null;
    const out = {
        key: field.key,
        label: field.label,
        type: field.type || 'text',
        placeholder: field.placeholder,
        help: field.help,
        default: field.default,
        required: Boolean(field.required),
        filterType: field.filterType
    };
    if (field.options) out.options = field.options;
    if (field.requiredWhen) out.requiredWhen = field.requiredWhen;
    if (field.showWhen) out.showWhen = field.showWhen;
    return out;
}

function getManualConfigFieldsForType(equipmentType) {
    const meta = EQUIPMENT_TYPE_META[equipmentType];
    return (meta?.manualConfigFields || []).map(serializeConfigField).filter(Boolean);
}

function getCatalogForType(equipmentType) {
    return CATALOG_BY_TYPE[equipmentType] || null;
}

const LEGACY_MODEL_ALIASES = Object.freeze({
    elo_paypoint_15: 'elo_paypoint_plus_15',
    elo_paypoint_22: 'elo_paypoint_plus_22',
    star_tsp143: 'star_tsp143iii',
    star_tsp650: 'star_tsp650ii',
    bixolon_srp350: 'bixolon_srp350iii',
    symbol_ls2208: 'zebra_ls2208',
    apg_vasario: 'apg_vasario_1616',
    brother_ql820: 'brother_ql820nwb',
    epson_tm_m30: 'epson_tm_m30iii'
});

function resolveCatalogModelId(catalogModelId) {
    const id = String(catalogModelId || '').trim();
    return LEGACY_MODEL_ALIASES[id] || id;
}

function findModel(catalogModelId) {
    const id = resolveCatalogModelId(catalogModelId);
    if (!id) return null;
    for (const [equipmentType, typeCatalog] of Object.entries(CATALOG_BY_TYPE)) {
        for (const [brandId, brand] of Object.entries(typeCatalog.brands)) {
            for (const [modelKey, modelDef] of Object.entries(brand.models)) {
                if (modelDef.id === id) {
                    return {
                        equipmentType,
                        brandId,
                        brandLabel: brand.label,
                        modelKey,
                        ...modelDef
                    };
                }
            }
        }
    }
    return null;
}

function listBrandsForType(equipmentType) {
    const catalog = getCatalogForType(equipmentType);
    if (!catalog) return [];
    return Object.entries(catalog.brands)
        .map(([id, brand]) => ({
            id,
            label: brand.label,
            modelCount: Object.keys(brand.models).length
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

function listModelsForBrand(equipmentType, brandId) {
    const catalog = getCatalogForType(equipmentType);
    const brand = catalog?.brands?.[brandId];
    if (!brand) return [];
    return Object.entries(brand.models)
        .map(([, modelDef]) => ({
            id: modelDef.id,
            label: modelDef.label,
            driver: modelDef.driver || '',
            description: modelDef.description || ''
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

function getModelFields(catalogModelId) {
    const modelDef = findModel(catalogModelId);
    if (!modelDef) return { configFields: [], linkFields: [] };
    const configFields = [...(modelDef.configFields || [])];
    const linkFields = [...(modelDef.linkFields || [])];
    for (const lf of linkFields) {
        if (!configFields.some((f) => f.key === lf.key)) configFields.push(lf);
    }
    return { configFields, linkFields, model: modelDef };
}

function normalizeFieldOptions(field) {
    if (!field?.options?.length) return field;
    return {
        ...field,
        options: field.options.map((o) =>
            typeof o === 'string' ? { value: o, label: o.replace(/_/g, ' ') } : o
        )
    };
}

function getHardwareCatalogForAdmin() {
    const types = Object.values(EQUIPMENT_TYPE_META).map((t) => {
        const brands = listBrandsForType(t.id);
        const brandModels = {};
        for (const b of brands) {
            brandModels[b.id] = listModelsForBrand(t.id, b.id).map((m) => {
                const { configFields, linkFields } = getModelFields(m.id);
                return {
                    ...m,
                    configFields: configFields.map(normalizeFieldOptions),
                    linkFields: linkFields.map(normalizeFieldOptions)
                };
            });
        }
        return { ...t, brands, brandModels };
    });
    return {
        types,
        aioRegisterBuiltin: buildAioRegisterBuiltinMap(),
        builtinModelIds: collectBuiltinCatalogModelIds()
    };
}

function buildAioRegisterBuiltinMap() {
    const map = {};
    const reg = CATALOG_BY_TYPE.register;
    if (!reg?.brands) return Object.freeze(map);
    for (const brand of Object.values(reg.brands)) {
        for (const modelDef of Object.values(brand.models)) {
            if (modelDef.aioBuiltIn && Object.keys(modelDef.aioBuiltIn).length) {
                map[modelDef.id] = { ...modelDef.aioBuiltIn };
            }
        }
    }
    return Object.freeze(map);
}

function collectBuiltinCatalogModelIds() {
    const ids = new Set();
    for (const typeCatalog of Object.values(CATALOG_BY_TYPE)) {
        for (const [brandId, brand] of Object.entries(typeCatalog.brands || {})) {
            if (!String(brandId).includes('_builtin')) continue;
            for (const modelDef of Object.values(brand.models)) {
                ids.add(modelDef.id);
            }
        }
    }
    ids.add('elo_paypoint_printer');
    ids.add('elo_paypoint_customer_display');
    ids.add('elo_paypoint_drawer');
    ids.add('elo_paypoint_scanner');
    return Object.freeze([...ids]);
}

function isBuiltinCatalogModelId(catalogModelId) {
    return collectBuiltinCatalogModelIds().includes(String(catalogModelId || '').trim());
}

function getAioRegisterBuiltinProfile(registerCatalogModelId) {
    const id = String(registerCatalogModelId || '').trim();
    if (!id) return null;
    return buildAioRegisterBuiltinMap()[id] || null;
}

/**
 * Limit peripheral choices for a station when the register is an all-in-one with built-ins.
 * Kitchen / secondary printers always use external models only.
 */
function filterModelsForStationContext(equipmentType, registerCatalogModelId, models, options = {}) {
    const list = Array.isArray(models) ? models : [];
    const profile = getAioRegisterBuiltinProfile(registerCatalogModelId);
    const slot = String(options.slot || '');

    if (equipmentType === 'receipt_printer') {
        if (slot === 'kitchen') {
            return list.filter((m) => !isBuiltinCatalogModelId(m.id));
        }
        if (profile?.receiptPrinter) {
            return list.filter((m) => m.id === profile.receiptPrinter);
        }
        return list.filter((m) => !isBuiltinCatalogModelId(m.id));
    }

    if (equipmentType === 'customer_display') {
        if (profile?.customerDisplay) {
            return list.filter((m) => m.id === profile.customerDisplay);
        }
        return list.filter((m) => !isBuiltinCatalogModelId(m.id));
    }

    if (equipmentType === 'cash_drawer') {
        if (profile?.cashDrawer) {
            return list.filter((m) => m.id === profile.cashDrawer);
        }
        return list.filter((m) => !isBuiltinCatalogModelId(m.id));
    }

    if (equipmentType === 'barcode_scanner') {
        if (profile?.barcodeScanner) {
            return list.filter((m) => m.id === profile.barcodeScanner);
        }
        return list.filter((m) => !isBuiltinCatalogModelId(m.id));
    }

    return list;
}

function fieldMatchesWhen(field, config, whenKey) {
    const when = field?.[whenKey];
    if (!when) return false;
    const val = String(config?.[when.field] ?? '');
    if (when.equals !== undefined) return val === String(when.equals);
    if (Array.isArray(when.in)) return when.in.map(String).includes(val);
    return false;
}

function fieldVisible(field, config) {
    if (!field?.showWhen) return true;
    return fieldMatchesWhen(field, config, 'showWhen');
}

function fieldRequired(field, config) {
    if (field?.required) return true;
    if (field?.requiredWhen) return fieldMatchesWhen(field, config, 'requiredWhen');
    return false;
}

function isPayPointModel(catalogModelId) {
    return String(catalogModelId || '').toLowerCase().includes('paypoint');
}

function isAndroidAioRegister(catalogModelId) {
    const id = String(catalogModelId || '').toLowerCase();
    return (
        id.startsWith('sunmi_') ||
        id.startsWith('landi_reg_') ||
        id === 'aures_yuno'
    );
}

const STATION_EQUIPMENT_TYPES = new Set([
    'register',
    'card_terminal',
    'receipt_printer',
    'barcode_scanner',
    'cash_drawer',
    'customer_display',
    'label_printer',
    'scale'
]);

function validateEquipmentBinding(equipmentType, config, { serialNumber, posDeviceId } = {}) {
    if (!STATION_EQUIPMENT_TYPES.has(equipmentType)) {
        return { ok: true };
    }
    if (!posDeviceId) {
        return {
            ok: false,
            error: 'Assign this equipment to a register — that is how it ties to a live POS station',
            code: 'REGISTER_REQUIRED'
        };
    }
    if (equipmentType === 'register' || equipmentType === 'card_terminal') {
        if (!String(serialNumber || '').trim()) {
            return {
                ok: false,
                error: 'Serial number is required for registers and payment terminals',
                code: 'SERIAL_REQUIRED'
            };
        }
    }
    const modelId = config?.catalogModelId;
    if (
        equipmentType === 'register' &&
        (isPayPointModel(modelId) || isAndroidAioRegister(modelId)) &&
        !String(config?.address || '').trim()
    ) {
        return {
            ok: false,
            error: 'Device IP or hostname is required for this register model',
            code: 'ADDRESS_REQUIRED'
        };
    }
    return { ok: true };
}

function validateEquipmentConfig(equipmentType, config) {
    const cfg = config && typeof config === 'object' ? config : {};
    const catalogModelId = String(cfg.catalogModelId || '').trim();
    const typeMeta = EQUIPMENT_TYPE_META[equipmentType];
    if (!typeMeta) {
        return { ok: false, error: 'Unknown equipment type' };
    }
    if (!typeMeta.hasCatalog) {
        const configFields = getManualConfigFieldsForType(equipmentType);
        for (const field of configFields) {
            if (!fieldVisible(field, cfg)) continue;
            if (!fieldRequired(field, cfg)) continue;
            const val = cfg[field.key];
            if (val == null || String(val).trim() === '') {
                return { ok: false, error: `${field.label} is required` };
            }
        }
        return { ok: true, config: cfg };
    }
    if (!catalogModelId) {
        return { ok: false, error: 'Select a brand and model from the catalog' };
    }
    const modelDef = findModel(catalogModelId);
    if (!modelDef || modelDef.equipmentType !== equipmentType) {
        return { ok: false, error: 'Invalid catalog model for this equipment type' };
    }
    const { configFields } = getModelFields(catalogModelId);
    for (const field of configFields) {
        if (!fieldVisible(field, cfg)) continue;
        if (!fieldRequired(field, cfg)) continue;
        const val = cfg[field.key];
        if (val == null || String(val).trim() === '') {
            return { ok: false, error: `${field.label} is required for ${modelDef.label}` };
        }
    }
    return { ok: true, config: cfg, model: modelDef };
}

function catalogLabelsForConfig(config) {
    const modelDef = findModel(config?.catalogModelId);
    if (!modelDef) return { manufacturer: '', model: '' };
    return {
        manufacturer: modelDef.brandLabel,
        model: modelDef.label,
        catalogBrandId: modelDef.brandId,
        catalogModelId: modelDef.id,
        driver: modelDef.driver || ''
    };
}

module.exports = {
    EQUIPMENT_TYPE_META,
    CATALOG_BY_TYPE,
    getCatalogForType,
    findModel,
    listBrandsForType,
    listModelsForBrand,
    getModelFields,
    getManualConfigFieldsForType,
    serializeConfigField,
    getHardwareCatalogForAdmin,
    buildAioRegisterBuiltinMap,
    collectBuiltinCatalogModelIds,
    getAioRegisterBuiltinProfile,
    filterModelsForStationContext,
    isBuiltinCatalogModelId,
    validateEquipmentConfig,
    catalogLabelsForConfig,
    isPayPointModel,
    isAndroidAioRegister,
    validateEquipmentBinding,
    fieldVisible,
    fieldRequired,
    STATION_EQUIPMENT_TYPES
};
