'use strict';

function mapAdRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        title: row.title || '',
        subtitle: row.subtitle || '',
        imageUrl: row.image_url || '',
        linkUrl: row.link_url || '',
        sourceLabel: row.source_label || '',
        sortOrder: Number(row.sort_order) || 0,
        isActive: Boolean(row.is_active),
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function normalizeUrl(raw, max = 500) {
    return String(raw || '').trim().slice(0, max);
}

async function listDisplayAds(pool, { activeOnly = false } = {}) {
    const where = activeOnly
        ? `WHERE is_active = 1
           AND (starts_at IS NULL OR starts_at <= NOW())
           AND (ends_at IS NULL OR ends_at >= NOW())`
        : '';
    const [rows] = await pool.execute(
        `SELECT * FROM pos_display_ads ${where} ORDER BY sort_order ASC, id ASC`
    );
    return (rows || []).map(mapAdRow);
}

async function getDisplayAdById(pool, id) {
    const adId = Number(id);
    if (!Number.isInteger(adId) || adId <= 0) return null;
    const [rows] = await pool.execute(`SELECT * FROM pos_display_ads WHERE id = ? LIMIT 1`, [adId]);
    return rows[0] ? mapAdRow(rows[0]) : null;
}

async function createDisplayAd(pool, body, adminId) {
    const imageUrl = normalizeUrl(body.imageUrl || body.image_url);
    if (!imageUrl) {
        const err = new Error('Image URL is required');
        err.code = 'IMAGE_REQUIRED';
        throw err;
    }
    const [result] = await pool.execute(
        `INSERT INTO pos_display_ads
         (title, subtitle, image_url, link_url, source_label, sort_order, is_active, starts_at, ends_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            normalizeUrl(body.title, 120) || null,
            normalizeUrl(body.subtitle, 240) || null,
            imageUrl,
            normalizeUrl(body.linkUrl || body.link_url) || null,
            normalizeUrl(body.sourceLabel || body.source_label, 120) || null,
            Number(body.sortOrder ?? body.sort_order) || 0,
            body.isActive === false || body.is_active === false ? 0 : 1,
            body.startsAt || body.starts_at || null,
            body.endsAt || body.ends_at || null,
            adminId || null
        ]
    );
    return getDisplayAdById(pool, result.insertId);
}

async function updateDisplayAd(pool, id, body) {
    const existing = await getDisplayAdById(pool, id);
    if (!existing) {
        const err = new Error('Ad not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    const imageUrl =
        body.imageUrl !== undefined || body.image_url !== undefined
            ? normalizeUrl(body.imageUrl || body.image_url)
            : existing.imageUrl;
    if (!imageUrl) {
        const err = new Error('Image URL is required');
        err.code = 'IMAGE_REQUIRED';
        throw err;
    }
    await pool.execute(
        `UPDATE pos_display_ads SET
            title = ?,
            subtitle = ?,
            image_url = ?,
            link_url = ?,
            source_label = ?,
            sort_order = ?,
            is_active = ?,
            starts_at = ?,
            ends_at = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            body.title !== undefined ? normalizeUrl(body.title, 120) || null : existing.title || null,
            body.subtitle !== undefined ? normalizeUrl(body.subtitle, 240) || null : existing.subtitle || null,
            imageUrl,
            body.linkUrl !== undefined || body.link_url !== undefined
                ? normalizeUrl(body.linkUrl || body.link_url) || null
                : existing.linkUrl || null,
            body.sourceLabel !== undefined || body.source_label !== undefined
                ? normalizeUrl(body.sourceLabel || body.source_label, 120) || null
                : existing.sourceLabel || null,
            body.sortOrder !== undefined || body.sort_order !== undefined
                ? Number(body.sortOrder ?? body.sort_order) || 0
                : existing.sortOrder,
            body.isActive === false || body.is_active === false
                ? 0
                : body.isActive === true || body.is_active === true
                  ? 1
                  : existing.isActive
                    ? 1
                    : 0,
            body.startsAt !== undefined || body.starts_at !== undefined
                ? body.startsAt || body.starts_at || null
                : existing.startsAt,
            body.endsAt !== undefined || body.ends_at !== undefined
                ? body.endsAt || body.ends_at || null
                : existing.endsAt,
            Number(id)
        ]
    );
    return getDisplayAdById(pool, id);
}

async function deleteDisplayAd(pool, id) {
    const [result] = await pool.execute(`DELETE FROM pos_display_ads WHERE id = ?`, [Number(id)]);
    return result.affectedRows > 0;
}

module.exports = {
    listDisplayAds,
    getDisplayAdById,
    createDisplayAd,
    updateDisplayAd,
    deleteDisplayAd
};
