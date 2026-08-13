'use strict';

const { listEquipment, listEquipmentForRegister, getEquipmentById } = require('./posEquipment');
const { listDisplayAds } = require('./posDisplayAds');
const { findModel } = require('./posHardwareCatalog');

function isMarketingDisplay(equipment) {
    if (!equipment || equipment.equipmentType !== 'customer_display' || !equipment.isActive) return false;
    const mode = String(equipment.config?.mode || 'browser').toLowerCase();
    if (mode === 'pole') return false;
    const modelId = equipment.config?.catalogModelId;
    if (modelId) {
        const modelDef = findModel(modelId);
        const fields = modelDef?.configFields || [];
        if (fields.some((f) => f.key === 'serialPort')) return false;
    }
    return true;
}

function mapDisplayRow(equipment, assignedAdIds = [], assignedAds = []) {
    return {
        id: equipment.id,
        label: equipment.label,
        manufacturer: equipment.manufacturer,
        model: equipment.model,
        posDeviceId: equipment.posDeviceId,
        posDeviceLabel: equipment.posDeviceLabel,
        adPlaylistMode: equipment.config?.adPlaylistMode || 'all',
        displayMode: equipment.config?.mode || 'browser',
        displayUrl: equipment.config?.url || '',
        assignedAdIds,
        assignedAds
    };
}

async function loadAssignedAdIds(pool, equipmentId) {
    const [rows] = await pool.execute(
        `SELECT ad_id FROM pos_display_ad_assignments
         WHERE equipment_id = ?
         ORDER BY sort_order ASC, ad_id ASC`,
        [equipmentId]
    );
    return (rows || []).map((r) => Number(r.ad_id));
}

async function listFrontDisplays(pool) {
    const equipment = await listEquipment(pool, { includeInactive: false });
    const displays = equipment.filter(isMarketingDisplay);
    const ads = await listDisplayAds(pool);
    const adsById = new Map(ads.map((a) => [a.id, a]));

    const result = [];
    for (const row of displays) {
        const assignedAdIds = await loadAssignedAdIds(pool, row.id);
        const assignedAds = assignedAdIds.map((id) => adsById.get(id)).filter(Boolean);
        result.push(mapDisplayRow(row, assignedAdIds, assignedAds));
    }
    return result;
}

async function getFrontDisplay(pool, equipmentId) {
    const equipment = await getEquipmentById(pool, equipmentId);
    if (!equipment || !isMarketingDisplay(equipment)) return null;
    const assignedAdIds = await loadAssignedAdIds(pool, equipment.id);
    const ads = await listDisplayAds(pool);
    const adsById = new Map(ads.map((a) => [a.id, a]));
    const assignedAds = assignedAdIds.map((id) => adsById.get(id)).filter(Boolean);
    return mapDisplayRow(equipment, assignedAdIds, assignedAds);
}

async function setDisplayAdAssignments(pool, equipmentId, adIds) {
    const equipment = await getEquipmentById(pool, equipmentId);
    if (!equipment || equipment.equipmentType !== 'customer_display') {
        const err = new Error('Customer display not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (!isMarketingDisplay(equipment)) {
        const err = new Error('This display does not support marketing ad playlists');
        err.code = 'INVALID_EQUIPMENT';
        throw err;
    }

    const ids = [...new Set((Array.isArray(adIds) ? adIds : []).map((id) => Number(id)).filter((id) => id > 0))];
    if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        const [existing] = await pool.execute(
            `SELECT id FROM pos_display_ads WHERE id IN (${placeholders})`,
            ids
        );
        if ((existing || []).length !== ids.length) {
            const err = new Error('One or more ads were not found');
            err.code = 'AD_NOT_FOUND';
            throw err;
        }
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.execute(`DELETE FROM pos_display_ad_assignments WHERE equipment_id = ?`, [equipmentId]);
        let sortOrder = 0;
        for (const adId of ids) {
            await conn.execute(
                `INSERT INTO pos_display_ad_assignments (equipment_id, ad_id, sort_order) VALUES (?, ?, ?)`,
                [equipmentId, adId, sortOrder++]
            );
        }
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }

    return getFrontDisplay(pool, equipmentId);
}

async function listDisplayAdsForRegister(pool, posDeviceRecordId) {
    const equipment = await listEquipmentForRegister(pool, posDeviceRecordId);
    const display = equipment.find(isMarketingDisplay);
    const allActive = await listDisplayAds(pool, { activeOnly: true });

    if (!display) return allActive;

    const mode = String(display.config?.adPlaylistMode || 'all').toLowerCase();
    if (mode !== 'selected') return allActive;

    const assignedAdIds = await loadAssignedAdIds(pool, display.id);
    if (!assignedAdIds.length) return allActive;

    const byId = new Map(allActive.map((ad) => [ad.id, ad]));
    return assignedAdIds.map((id) => byId.get(id)).filter(Boolean);
}

module.exports = {
    isMarketingDisplay,
    listFrontDisplays,
    getFrontDisplay,
    setDisplayAdAssignments,
    listDisplayAdsForRegister
};
