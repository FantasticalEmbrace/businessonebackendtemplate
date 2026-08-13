'use strict';

const {
    EQUIPMENT_TYPE_META,
    getHardwareCatalogForAdmin,
    validateEquipmentConfig,
    catalogLabelsForConfig,
    findModel,
    validateEquipmentBinding,
    getManualConfigFieldsForType
} = require('./posHardwareCatalog');

function normalizeEquipmentType(raw) {
    const id = String(raw || '').trim().toLowerCase();
    return EQUIPMENT_TYPE_META[id] ? id : 'other';
}

function parseConfig(raw) {
    if (raw == null || raw === '') return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
    try {
        const parsed = JSON.parse(String(raw));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function normalizeMacAddress(raw) {
    const hex = String(raw || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (!hex) return null;
    if (hex.length !== 12) {
        const err = new Error('MAC address must be 12 hex characters (e.g. AA:BB:CC:DD:EE:FF)');
        err.code = 'INVALID_MAC';
        throw err;
    }
    return hex.match(/.{2}/g).join(':');
}

function mapEquipmentRow(row) {
    const config = parseConfig(row.config_json);
    const modelDef = config.catalogModelId ? findModel(config.catalogModelId) : null;
    return {
        id: row.id,
        equipmentType: row.equipment_type,
        equipmentTypeLabel: EQUIPMENT_TYPE_META[row.equipment_type]?.label || row.equipment_type,
        label: row.label,
        manufacturer: row.manufacturer || modelDef?.brandLabel || '',
        model: row.model || modelDef?.label || '',
        catalogModelId: config.catalogModelId || '',
        catalogBrandId: config.catalogBrandId || modelDef?.brandId || '',
        serialNumber: row.serial_number || '',
        macAddress: row.mac_address || '',
        posDeviceId: row.pos_device_id != null ? Number(row.pos_device_id) : null,
        posDeviceLabel: row.pos_device_label || null,
        config,
        notes: row.notes || '',
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function listEquipment(pool, { includeInactive = true } = {}) {
    const where = includeInactive ? '' : 'WHERE e.is_active = 1';
    const [rows] = await pool.execute(
        `SELECT e.*, d.device_label AS pos_device_label
         FROM pos_equipment e
         LEFT JOIN pos_devices d ON d.id = e.pos_device_id
         ${where}
         ORDER BY e.is_active DESC, e.label ASC`
    );
    return (rows || []).map(mapEquipmentRow);
}

async function listEquipmentForRegister(pool, posDeviceRecordId) {
    const id = Number(posDeviceRecordId);
    if (!Number.isInteger(id) || id <= 0) return [];
    const [rows] = await pool.execute(
        `SELECT e.*, d.device_label AS pos_device_label
         FROM pos_equipment e
         LEFT JOIN pos_devices d ON d.id = e.pos_device_id
         WHERE e.is_active = 1 AND e.pos_device_id = ?
         ORDER BY e.equipment_type ASC, e.label ASC`,
        [id]
    );
    return (rows || []).map(mapEquipmentRow);
}

async function getEquipmentById(pool, equipmentId) {
    const id = Number(equipmentId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const [rows] = await pool.execute(
        `SELECT e.*, d.device_label AS pos_device_label
         FROM pos_equipment e
         LEFT JOIN pos_devices d ON d.id = e.pos_device_id
         WHERE e.id = ? LIMIT 1`,
        [id]
    );
    return rows[0] ? mapEquipmentRow(rows[0]) : null;
}

function prepareEquipmentPayload(body) {
    const equipmentType = normalizeEquipmentType(body.equipmentType || body.equipment_type);
    const label = String(body.label || '').trim().slice(0, 128);
    if (label.length < 2) {
        const err = new Error('Equipment name must be at least 2 characters');
        err.code = 'INVALID_LABEL';
        throw err;
    }

    let config = parseConfig(body.config || body.config_json);
    const validation = validateEquipmentConfig(equipmentType, config);
    if (!validation.ok) {
        const err = new Error(validation.error);
        err.code = 'INVALID_CONFIG';
        throw err;
    }
    config = validation.config;

    const catalogLabels = catalogLabelsForConfig(config);
    if (catalogLabels.catalogBrandId) {
        config.catalogBrandId = catalogLabels.catalogBrandId;
    }

    let manufacturer = String(body.manufacturer || '').trim().slice(0, 128) || null;
    let model = String(body.model || '').trim().slice(0, 128) || null;
    if (catalogLabels.manufacturer) manufacturer = catalogLabels.manufacturer;
    if (catalogLabels.model) model = catalogLabels.model;

    const posDeviceId =
        body.posDeviceId != null && body.posDeviceId !== '' ? Number(body.posDeviceId) : null;
    if (posDeviceId != null && (!Number.isInteger(posDeviceId) || posDeviceId <= 0)) {
        const err = new Error('Invalid register assignment');
        err.code = 'INVALID_DEVICE';
        throw err;
    }

    if (config.linkedPrinterEquipmentId) {
        const linkedId = Number(config.linkedPrinterEquipmentId);
        if (!Number.isInteger(linkedId) || linkedId <= 0) {
            const err = new Error('Invalid linked printer');
            err.code = 'INVALID_CONFIG';
            throw err;
        }
        config.linkedPrinterEquipmentId = linkedId;
    }

    const serialNumber =
        String(body.serialNumber || body.serial_number || '').trim().slice(0, 128) || null;

    let macAddress = null;
    if (body.macAddress !== undefined || body.mac_address !== undefined) {
        const rawMac = body.macAddress !== undefined ? body.macAddress : body.mac_address;
        const trimmed = String(rawMac || '').trim();
        macAddress = trimmed ? normalizeMacAddress(trimmed) : null;
    }

    const binding = validateEquipmentBinding(equipmentType, config, { serialNumber, posDeviceId });
    if (!binding.ok) {
        const err = new Error(binding.error);
        err.code = binding.code;
        throw err;
    }

    return {
        equipmentType,
        label,
        manufacturer,
        model,
        serialNumber,
        macAddress,
        posDeviceId,
        config,
        notes: String(body.notes || '').trim().slice(0, 2000) || null,
        isActive: !(body.isActive === false || body.is_active === false)
    };
}

async function createEquipment(pool, body) {
    const payload = prepareEquipmentPayload(body);
    const [result] = await pool.execute(
        `INSERT INTO pos_equipment
         (equipment_type, label, manufacturer, model, serial_number, mac_address, pos_device_id, config_json, notes, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            payload.equipmentType,
            payload.label,
            payload.manufacturer,
            payload.model,
            payload.serialNumber,
            payload.macAddress,
            payload.posDeviceId,
            JSON.stringify(payload.config),
            payload.notes,
            payload.isActive ? 1 : 0
        ]
    );
    return getEquipmentById(pool, result.insertId);
}

async function updateEquipment(pool, equipmentId, body) {
    const existing = await getEquipmentById(pool, equipmentId);
    if (!existing) {
        const err = new Error('Equipment not found');
        err.code = 'NOT_FOUND';
        throw err;
    }

    const merged = {
        equipmentType: body.equipmentType != null ? body.equipmentType : existing.equipmentType,
        label: body.label != null ? body.label : existing.label,
        manufacturer: body.manufacturer !== undefined ? body.manufacturer : existing.manufacturer,
        model: body.model !== undefined ? body.model : existing.model,
        serialNumber:
            body.serialNumber !== undefined || body.serial_number !== undefined
                ? body.serialNumber || body.serial_number
                : existing.serialNumber,
        macAddress:
            body.macAddress !== undefined || body.mac_address !== undefined
                ? body.macAddress !== undefined
                    ? body.macAddress
                    : body.mac_address
                : existing.macAddress,
        posDeviceId:
            body.posDeviceId !== undefined || body.pos_device_id !== undefined
                ? body.posDeviceId !== undefined
                    ? body.posDeviceId
                    : body.pos_device_id
                : existing.posDeviceId,
        config: body.config !== undefined ? body.config : existing.config,
        notes: body.notes !== undefined ? body.notes : existing.notes,
        isActive:
            body.isActive !== undefined || body.is_active !== undefined
                ? !(body.isActive === false || body.is_active === false)
                : existing.isActive
    };

    const payload = prepareEquipmentPayload(merged);
    await pool.execute(
        `UPDATE pos_equipment SET
            equipment_type = ?,
            label = ?,
            manufacturer = ?,
            model = ?,
            serial_number = ?,
            mac_address = ?,
            pos_device_id = ?,
            config_json = ?,
            notes = ?,
            is_active = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            payload.equipmentType,
            payload.label,
            payload.manufacturer,
            payload.model,
            payload.serialNumber,
            payload.macAddress,
            payload.posDeviceId,
            JSON.stringify(payload.config),
            payload.notes,
            payload.isActive ? 1 : 0,
            Number(equipmentId)
        ]
    );
    return getEquipmentById(pool, equipmentId);
}

async function deleteEquipment(pool, equipmentId) {
    const [result] = await pool.execute(`DELETE FROM pos_equipment WHERE id = ?`, [Number(equipmentId)]);
    return result.affectedRows > 0;
}

const MOBILE_READER_MODELS = Object.freeze({
    idtech_vp3350: { brandId: 'idtech', label: 'ID Tech VP3350 (Bluetooth)' },
    dejavoo_qd4: { brandId: 'dejavoo', label: 'Dejavoo QD4 (portable)' },
    pax_a920: { brandId: 'pax', label: 'PAX A920 (mobile terminal)' }
});

async function getMobileCardReaderForRegister(pool, posDeviceRecordId) {
    const equipment = await listEquipmentForRegister(pool, posDeviceRecordId);
    const terminal = (equipment || []).find((row) => row.equipmentType === 'card_terminal') || null;
    if (!terminal) return null;
    return {
        equipmentId: terminal.id,
        label: terminal.label,
        poiDeviceId: String(terminal.config?.poiDeviceId || '').trim(),
        catalogModelId: String(terminal.config?.catalogModelId || '').trim(),
        connection: String(terminal.config?.connection || '').trim(),
        serialNumber: terminal.serialNumber || ''
    };
}

async function upsertMobileCardReaderForRegister(pool, posDeviceRecordId, body = {}) {
    const id = Number(posDeviceRecordId);
    if (!Number.isInteger(id) || id <= 0) {
        const err = new Error('Register not found');
        err.code = 'INVALID_DEVICE';
        throw err;
    }

    const poiDeviceId = String(body.poiDeviceId || body.poi_device_id || '').trim();
    if (!poiDeviceId) {
        const err = new Error('POI device ID is required (from NMI NMI)');
        err.code = 'INVALID_POI';
        throw err;
    }

    const catalogModelId = String(body.catalogModelId || body.catalog_model_id || 'idtech_vp3350').trim();
    const modelMeta = MOBILE_READER_MODELS[catalogModelId] || MOBILE_READER_MODELS.idtech_vp3350;
    const label = String(body.label || 'Mobile card reader').trim().slice(0, 128);
    const serialNumber = String(body.serialNumber || body.serial_number || poiDeviceId).trim().slice(0, 128);

    const config = {
        catalogModelId,
        catalogBrandId: modelMeta.brandId,
        connection: String(body.connection || 'bluetooth').trim() || 'bluetooth',
        poiDeviceId
    };

    const existing = (await listEquipmentForRegister(pool, id)).find((row) => row.equipmentType === 'card_terminal');
    const payload = {
        equipmentType: 'card_terminal',
        label,
        posDeviceId: id,
        serialNumber,
        config,
        isActive: true
    };

    if (existing) {
        return updateEquipment(pool, existing.id, payload);
    }
    return createEquipment(pool, payload);
}

function listMobileCardReaderModels() {
    return Object.entries(MOBILE_READER_MODELS).map(([id, meta]) => ({
        id,
        label: meta.label,
        brandId: meta.brandId
    }));
}

function listEquipmentTypeCatalog() {
    return Object.values(EQUIPMENT_TYPE_META).map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        hasCatalog: false,
        configFields: getManualConfigFieldsForType(t.id)
    }));
}

module.exports = {
    EQUIPMENT_TYPE_META,
    normalizeEquipmentType,
    listEquipment,
    listEquipmentForRegister,
    getEquipmentById,
    createEquipment,
    updateEquipment,
    deleteEquipment,
    getMobileCardReaderForRegister,
    upsertMobileCardReaderForRegister,
    listMobileCardReaderModels,
    listEquipmentTypeCatalog,
    getHardwareCatalogForAdmin
};
