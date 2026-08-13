'use strict';

const { listEquipment } = require('./posEquipment');
const { listDevices } = require('./posDeviceRegistry');
const { loadPosSettings } = require('./posSettings');
const { loadMerchantLicense, countActiveDevices, isLicenseWritable } = require('./posMerchantLicense');
const { buildRegisterHardwareProfile } = require('./posRegisterHardware');
const { buildNetworkSetupAssistant } = require('./posNetworkSetupAssistant');

function slugId(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 48);
}

function daysSince(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

function suggestActionForHardwareIssue(issueText, profile) {
    const text = String(issueText || '').toLowerCase();
    if (text.includes('no pos register equipment')) {
        return { actionId: 'add_equipment', tab: 'equipment' };
    }
    if (text.includes('payment terminal') && text.includes('poi')) {
        return { actionId: 'go_payments', tab: 'payments' };
    }
    if (text.includes('payment terminal')) {
        const terminal = profile?.cardTerminal;
        if (terminal?.id) {
            return { actionId: 'edit_equipment', tab: 'equipment', equipmentId: terminal.id };
        }
        return { actionId: 'go_equipment', tab: 'equipment' };
    }
    if (text.includes('register')) {
        const reg = profile?.register;
        if (reg?.id) {
            return { actionId: 'edit_equipment', tab: 'equipment', equipmentId: reg.id };
        }
        return { actionId: 'add_equipment', tab: 'equipment' };
    }
    if (text.includes('receipt printer') || text.includes('cash drawer') || text.includes('customer display')) {
        return { actionId: 'go_equipment', tab: 'equipment' };
    }
    return { actionId: 'go_equipment', tab: 'equipment' };
}

function buildTroubleshootStatusReport(snapshot) {
    const issues = snapshot?.issues || [];
    const okItems = snapshot?.okItems || [];
    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity !== 'error');

    let headline = 'Everything looks good — no problems found.';
    if (errors.length && warnings.length) {
        headline = `${errors.length} urgent issue(s) and ${warnings.length} warning(s) need attention.`;
    } else if (errors.length === 1) {
        headline = '1 urgent issue needs attention.';
    } else if (errors.length > 1) {
        headline = `${errors.length} urgent issues need attention.`;
    } else if (warnings.length === 1) {
        headline = '1 thing could be improved.';
    } else if (warnings.length > 1) {
        headline = `${warnings.length} things could be improved.`;
    }

    const primaryMissing = errors[0] || warnings[0] || null;
    const nextStep = primaryMissing
        ? {
              title: primaryMissing.label,
              summary: primaryMissing.detail || '',
              category: primaryMissing.category,
              tab: primaryMissing.tab || 'general'
          }
        : null;

    const fingerprint = JSON.stringify({
        issueIds: issues.map((i) => i.id).sort(),
        okCount: okItems.length,
        registerCount: snapshot?.counts?.registers || 0,
        equipmentCount: snapshot?.counts?.equipment || 0,
        licenseStatus: snapshot?.license?.status || '',
        networkAllDone: Boolean(snapshot?.network?.allDone)
    });

    return {
        fingerprint,
        headline,
        allClear: issues.length === 0,
        nextStep,
        issues,
        okItems,
        primaryMissing,
        counts: snapshot?.counts || {},
        categories: snapshot?.categories || {}
    };
}

async function buildStoreTroubleshootReport(pool, clientState = {}) {
    const [networkAssistant, posSettings, license, activeDeviceCount, equipment, devices] = await Promise.all([
        buildNetworkSetupAssistant(pool, clientState),
        loadPosSettings(pool),
        loadMerchantLicense(pool),
        countActiveDevices(pool),
        listEquipment(pool, { includeInactive: false }),
        listDevices(pool)
    ]);

    const issues = [];
    const okItems = [];
    const categories = {
        network: 0,
        hardware: 0,
        registers: 0,
        payments: 0,
        license: 0,
        general: 0
    };

    const networkReport = networkAssistant.statusReport || {};
    for (const m of networkReport.missingItems || []) {
        if (m.id === 'backup_test') continue;
        issues.push({
            id: `network_${m.id}`,
            severity: m.id === 'no_equipment' ? 'error' : 'warning',
            category: 'network',
            label: m.label,
            detail: m.detail,
            actionId: m.actionId,
            equipmentId: m.equipmentId || null,
            tab: 'equipment'
        });
        categories.network += 1;
    }

    if (networkReport.allDone) {
        okItems.push('Store network setup is complete');
    } else if ((networkReport.completedItems || []).length) {
        okItems.push(...networkReport.completedItems.map((t) => `Network: ${t}`));
    }

    if (!devices.length) {
        issues.push({
            id: 'no_registers',
            severity: 'error',
            category: 'registers',
            label: 'No registers set up yet',
            detail: 'Add at least one register under Registers, then pair the POS app with its key.',
            actionId: 'go_registers',
            tab: 'registers'
        });
        categories.registers += 1;
    }

    const globalPrinter = posSettings.pos_hardware_printer || 'auto';
    const globalPoi = String(posSettings.pos_poi_device_id || '').trim();
    const cardCheckoutEnabled =
        posSettings.pos_display_card_checkout === 'true' || posSettings.pos_payment_card_enabled === 'true';

    for (const device of devices) {
        const profile = await buildRegisterHardwareProfile(pool, device.id, {
            globalPrinter,
            globalCheckout: { poiDeviceId: globalPoi }
        });

        const label = device.device_label || `Register ${device.id}`;
        const staleDays = daysSince(device.last_seen_at);

        if (!device.last_seen_at) {
            issues.push({
                id: `reg_never_seen_${device.id}`,
                severity: 'warning',
                category: 'registers',
                label: `${label} has never checked in`,
                detail: 'Open the POS app on that device and sign in with this register’s key.',
                actionId: 'go_registers',
                tab: 'registers',
                deviceId: device.id
            });
            categories.registers += 1;
        } else if (staleDays != null && staleDays >= 14) {
            issues.push({
                id: `reg_stale_${device.id}`,
                severity: 'warning',
                category: 'registers',
                label: `${label} has not been seen in ${staleDays} days`,
                detail: 'The register may be offline or using an old key. Check power, Wi‑Fi, and the POS app.',
                actionId: 'go_registers',
                tab: 'registers',
                deviceId: device.id
            });
            categories.registers += 1;
        } else {
            okItems.push(`${label} checked in recently`);
        }

        if (!profile.issues?.length) {
            okItems.push(`${label} hardware wiring looks complete`);
        } else {
            for (const issueText of profile.issues) {
                const hint = suggestActionForHardwareIssue(issueText, profile);
                issues.push({
                    id: `hw_${device.id}_${slugId(issueText)}`,
                    severity: issueText.toLowerCase().includes('no pos register') ? 'error' : 'warning',
                    category: 'hardware',
                    label: `${label}: ${issueText}`,
                    detail: 'Fix this under Equipment for that register.',
                    actionId: hint.actionId,
                    equipmentId: hint.equipmentId || null,
                    tab: hint.tab || 'equipment',
                    deviceId: device.id
                });
                categories.hardware += 1;
            }
        }
    }

    const unassignedEquipment = equipment.filter((eq) => !eq.posDeviceId && eq.equipmentType !== 'other');
    for (const eq of unassignedEquipment) {
        issues.push({
            id: `eq_unassigned_${eq.id}`,
            severity: 'warning',
            category: 'hardware',
            label: `${eq.label} is not assigned to a register`,
            detail: 'Choose which register uses this device under Equipment.',
            actionId: 'edit_equipment',
            equipmentId: eq.id,
            tab: 'equipment'
        });
        categories.hardware += 1;
    }

    const licenseGate = isLicenseWritable(license);
    if (!licenseGate.ok) {
        issues.push({
            id: 'license_inactive',
            severity: 'error',
            category: 'license',
            label: 'POS license is not active',
            detail: licenseGate.message || 'Review billing and license status.',
            actionId: 'go_license',
            tab: 'license'
        });
        categories.license += 1;
    } else if (licenseGate.warningMessage) {
        issues.push({
            id: 'license_warning',
            severity: 'warning',
            category: 'license',
            label: 'License needs attention',
            detail: licenseGate.warningMessage,
            actionId: 'go_license',
            tab: 'license'
        });
        categories.license += 1;
    } else {
        okItems.push(`License active (${license.status})`);
    }

    if (activeDeviceCount > license.licensedStationCount) {
        issues.push({
            id: 'license_station_limit',
            severity: 'error',
            category: 'license',
            label: 'Too many active registers for your license',
            detail: `${activeDeviceCount} active register(s) but only ${license.licensedStationCount} licensed station(s).`,
            actionId: 'go_license',
            tab: 'license'
        });
        categories.license += 1;
    }

    if (cardCheckoutEnabled && !globalPoi) {
        const anyTerminalPoi = equipment.some(
            (eq) => eq.equipmentType === 'card_terminal' && String(eq.config?.poiDeviceId || '').trim()
        );
        if (!anyTerminalPoi) {
            issues.push({
                id: 'payments_no_poi',
                severity: 'warning',
                category: 'payments',
                label: 'Card payments enabled but no terminal POI ID on file',
                detail: 'Add a payment terminal under Equipment for each register and enter its NMI POI device ID.',
                actionId: 'go_equipment',
                tab: 'equipment'
            });
            categories.payments += 1;
        }
    }

    if (cardCheckoutEnabled) {
        okItems.push('Card checkout is enabled');
    }

    if (!String(posSettings.pos_support_phone || '').trim()) {
        issues.push({
            id: 'general_no_support_phone',
            severity: 'warning',
            category: 'general',
            label: 'Support phone not set',
            detail: 'Staff can call this number from the POS help screen.',
            actionId: 'go_general',
            tab: 'general'
        });
        categories.general += 1;
    }

    const snapshot = {
        issues,
        okItems: [...new Set(okItems)],
        counts: {
            registers: devices.length,
            equipment: equipment.length,
            issues: issues.length,
            errors: issues.filter((i) => i.severity === 'error').length,
            warnings: issues.filter((i) => i.severity !== 'error').length
        },
        categories,
        network: networkReport,
        license: {
            status: license.status,
            licensedStationCount: license.licensedStationCount,
            activeDevices: activeDeviceCount
        },
        registers: devices.map((d) => ({
            id: d.id,
            label: d.device_label,
            lastSeenAt: d.last_seen_at || null,
            staleDays: daysSince(d.last_seen_at)
        }))
    };

    snapshot.statusReport = buildTroubleshootStatusReport(snapshot);
    return snapshot;
}

module.exports = {
    buildStoreTroubleshootReport,
    buildTroubleshootStatusReport
};
