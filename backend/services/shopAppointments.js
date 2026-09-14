'use strict';

const personnel = require('./posPersonnel');
const { loadPosShopSettings } = require('./posShopSettings');

const DEFAULT_SLOT_MINUTES = 60;
const DEFAULT_DAY_START = '08:00';
const DEFAULT_DAY_END = '17:00';

function parseJson(val, fallback) {
    if (val == null) return fallback;
    if (typeof val === 'object') return val;
    try {
        return JSON.parse(val);
    } catch {
        return fallback;
    }
}

function normalizeHm(value) {
    const raw = String(value || '').trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '09:00';
    const h = Math.min(23, Math.max(0, Number(m[1])));
    const min = Math.min(59, Math.max(0, Number(m[2])));
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function hmToMinutes(hm) {
    const [h, m] = normalizeHm(hm).split(':').map(Number);
    return h * 60 + m;
}

function normalizeJobType(value) {
    const s = String(value || '').toLowerCase().trim();
    if (s === 'auto' || s === 'automotive' || s === 'service') return 'auto';
    if (s === 'body' || s === 'collision' || s === 'bodyshop') return 'body';
    if (s === 'tire' || s === 'tires' || s === 'tireshop') return 'tire';
    if (s === 'upholstery' || s === 'uphol' || s === 'upholster') return 'upholstery';
    return s || 'auto';
}

function rowToAppt(row) {
    if (!row) return null;
    const startsAt = row.starts_at;
    const startTime =
        startsAt instanceof Date
            ? `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`
            : String(startsAt || '').slice(11, 16);
    return {
        id: String(row.id),
        dbId: row.id,
        jobType: row.job_type,
        bay: row.bay || '',
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        startTime: startTime || '',
        date: String(row.starts_at || '').slice(0, 10),
        customerName: row.customer_name || '',
        phone: row.phone || '',
        email: row.email || '',
        vehicle: row.vehicle || '',
        vin: row.vin || '',
        notes: row.notes || '',
        jobId: row.job_id != null ? String(row.job_id) : null,
        status: row.status || 'scheduled',
        technicianId: row.technician_id != null ? String(row.technician_id) : null,
        technicianName: row.technician_name || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/** Public/staff booking list — never exposes technician assignment. */
function rowToPublicAppt(row) {
    const a = rowToAppt(row);
    if (!a) return null;
    return {
        id: a.id,
        dbId: a.dbId,
        jobType: a.jobType,
        bay: a.bay,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        startTime: a.startTime,
        date: a.date,
        customerName: a.customerName,
        phone: a.phone,
        email: a.email,
        vehicle: a.vehicle,
        vin: a.vin,
        notes: a.notes,
        jobId: a.jobId,
        status: a.status,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt
    };
}

function appointmentOverlapsSlot(appt, day, startMin, endMin) {
    const apptDay = String(appt.date || appt.startsAt || '').slice(0, 10);
    if (apptDay !== day) return false;
    const status = String(appt.status || 'scheduled').toLowerCase();
    if (status === 'cancelled' || status === 'canceled' || status === 'no_show') return false;
    const apptStart = hmToMinutes(appt.startTime || String(appt.startsAt || '').slice(11, 16) || '09:00');
    let apptEnd = apptStart + DEFAULT_SLOT_MINUTES;
    if (appt.endsAt) {
        const endDay = String(appt.endsAt).slice(0, 10);
        const endHm = normalizeHm(String(appt.endsAt).slice(11, 16));
        if (endDay === day && endHm) apptEnd = hmToMinutes(endHm);
    }
    return apptStart < endMin && apptEnd > startMin;
}

function employeeDisplayName(row) {
    return `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.employee_code || `Tech ${row.id}`;
}

function isShopTechnician(row) {
    if (!row || !row.is_active) return false;
    if (row.is_technician != null && row.is_technician !== undefined) {
        return Number(row.is_technician) !== 0;
    }
    // Legacy fallback before is_technician column is populated
    if (row.can_view_shop_floor == null) return false;
    return Number(row.can_view_shop_floor) !== 0;
}

async function listShopTechnicians(pool) {
    const rows = await personnel.listEmployees(pool);
    return (rows || []).filter(isShopTechnician);
}

async function bayNamesForJobType(pool, jobType) {
    const type = normalizeJobType(jobType);
    try {
        const settings = await loadPosShopSettings(pool);
        const list = settings?.bays?.[type];
        if (Array.isArray(list) && list.length) {
            return list.map((n) => String(n || '').trim()).filter(Boolean);
        }
    } catch {
        /* use defaults */
    }
    const defaults = {
        auto: ['Bay 1', 'Bay 2', 'Bay 3'],
        body: ['Booth A', 'Booth B', 'Prep bay'],
        tire: ['Rack 1', 'Rack 2', 'Mount bay'],
        upholstery: ['Bench 1', 'Bench 2', 'Pickup staging']
    };
    return defaults[type] || defaults.auto;
}

/**
 * Calendar capacity is bay-based (shop verticals only).
 * N named bays ⇒ up to N overlapping bookings at the same time.
 * Technician may be assigned server-side for staff/admin — never required for booking.
 */
async function getBayAvailability(pool, { date, time, durationMins, jobType, excludeId } = {}) {
    const day = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const startHm = normalizeHm(time || '09:00');
    const mins = Math.max(15, Number(durationMins) || DEFAULT_SLOT_MINUTES);
    const startMin = hmToMinutes(startHm);
    const endMin = startMin + mins;
    const type = normalizeJobType(jobType || 'auto');
    const allBays = await bayNamesForJobType(pool, type);

    const dayStartMin = hmToMinutes(DEFAULT_DAY_START);
    const dayEndMin = hmToMinutes(DEFAULT_DAY_END);
    const withinHours = startMin >= dayStartMin && endMin <= dayEndMin;

    const { appointments } = await listAppointments(pool, {
        from: `${day}T00:00:00`,
        to: `${day}T23:59:59`,
        jobType: type,
        includeTechnician: true
    });
    const overlapping = (appointments || []).filter((a) => {
        if (excludeId && String(a.id) === String(excludeId)) return false;
        if (a.jobType && normalizeJobType(a.jobType) !== type) return false;
        return appointmentOverlapsSlot(a, day, startMin, endMin);
    });

    const busyBays = new Set();
    let orphans = 0;
    for (const a of overlapping) {
        const bay = String(a.bay || '').trim();
        if (bay) busyBays.add(bay.toLowerCase());
        else orphans += 1;
    }

    let free = withinHours
        ? allBays.filter((b) => !busyBays.has(String(b).toLowerCase()))
        : [];
    if (orphans > 0) free = free.slice(orphans);

    const mapBay = (name, available) => ({
        id: name,
        name,
        available
    });

    return {
        jobType: type,
        bays: allBays.map((b) => mapBay(b, free.some((f) => f === b))),
        available: free.map((b) => mapBay(b, true)),
        openCount: free.length,
        totalCount: allBays.length,
        date: day,
        time: startHm,
        withinHours
    };
}

async function resolveBay(pool, body = {}) {
    const day = String(
        body.date || String(body.startsAt || body.startAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    ).slice(0, 10);
    const startTime = normalizeHm(
        body.startTime || body.time || String(body.startsAt || body.startAt || '').slice(11, 16) || '09:00'
    );
    const jobType = normalizeJobType(body.jobType || body.job_type || 'auto');
    const preferred = String(body.bay || '').trim();
    const avail = await getBayAvailability(pool, {
        date: day,
        time: startTime,
        durationMins: body.durationMins,
        jobType
    });
    if (!avail.available.length) {
        const err = new Error(
            avail.totalCount
                ? `All ${avail.totalCount} bays are booked at ${startTime}. Choose another time.`
                : `No bays configured for this shop. Add bays in admin shop settings.`
        );
        err.code = 'NO_BAY_AVAILABLE';
        err.status = 409;
        throw err;
    }
    if (preferred) {
        const hit = avail.available.find((b) => String(b.name).toLowerCase() === preferred.toLowerCase());
        if (!hit) {
            const err = new Error(`${preferred} is not available at ${startTime}.`);
            err.code = 'BAY_BUSY';
            err.status = 409;
            throw err;
        }
        return hit.name;
    }
    return avail.available[0].name;
}

/**
 * Optional internal tech assignment (staff/admin). Never blocks booking.
 * Prefers a technician clocked into the claimed bay, else first free shop tech.
 */
async function resolveTechnicianOptional(pool, body = {}, bayName) {
    const day = String(
        body.date || String(body.startsAt || body.startAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    ).slice(0, 10);
    const startTime = normalizeHm(
        body.startTime || body.time || String(body.startsAt || body.startAt || '').slice(11, 16) || '09:00'
    );
    const mins = Math.max(15, Number(body.durationMins) || DEFAULT_SLOT_MINUTES);
    const startMin = hmToMinutes(startTime);
    const endMin = startMin + mins;

    const roster = await listShopTechnicians(pool);
    if (!roster.length) return null;

    // Prefer tech currently clocked into this bay
    if (bayName && typeof personnel.listOpenTimeEntriesWithBay === 'function') {
        try {
            const open = await personnel.listOpenTimeEntriesWithBay(pool);
            const stationed = (open || []).find(
                (e) =>
                    String(e.bay || '').toLowerCase() === String(bayName).toLowerCase() &&
                    roster.some((r) => Number(r.id) === Number(e.employee_id))
            );
            if (stationed) {
                const tech = roster.find((r) => Number(r.id) === Number(stationed.employee_id));
                if (tech) return { id: String(tech.id), name: employeeDisplayName(tech) };
            }
        } catch {
            /* optional */
        }
    }

    const preferred = body.technicianId ?? body.technician_id ?? '';
    const { appointments } = await listAppointments(pool, {
        from: `${day}T00:00:00`,
        to: `${day}T23:59:59`,
        includeTechnician: true
    });
    const overlapping = (appointments || []).filter((a) => appointmentOverlapsSlot(a, day, startMin, endMin));
    const busyIds = new Set(
        overlapping
            .map((a) => (a.technicianId != null ? String(a.technicianId) : ''))
            .filter(Boolean)
    );
    const free = roster.filter((e) => !busyIds.has(String(e.id)));
    if (preferred != null && String(preferred) !== '') {
        const hit = free.find((t) => String(t.id) === String(preferred));
        if (hit) return { id: String(hit.id), name: employeeDisplayName(hit) };
    }
    if (!free.length) return null;
    return { id: String(free[0].id), name: employeeDisplayName(free[0]) };
}

/** @deprecated Capacity is bay-based; kept for staff tools that list shop technicians. */
async function getAvailableTechnicians(pool, { date, time, durationMins, excludeId } = {}) {
    const day = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const startHm = normalizeHm(time || '09:00');
    const mins = Math.max(15, Number(durationMins) || DEFAULT_SLOT_MINUTES);
    const startMin = hmToMinutes(startHm);
    const endMin = startMin + mins;
    const roster = await listShopTechnicians(pool);

    const { appointments } = await listAppointments(pool, {
        from: `${day}T00:00:00`,
        to: `${day}T23:59:59`,
        includeTechnician: true
    });
    const overlapping = (appointments || []).filter((a) => {
        if (excludeId && String(a.id) === String(excludeId)) return false;
        return appointmentOverlapsSlot(a, day, startMin, endMin);
    });
    const busyIds = new Set();
    for (const a of overlapping) {
        if (a.technicianId != null && String(a.technicianId) !== '') busyIds.add(String(a.technicianId));
    }
    const free = roster.filter((e) => !busyIds.has(String(e.id)));
    const mapTech = (e, available) => ({
        id: String(e.id),
        name: employeeDisplayName(e),
        employeeCode: e.employee_code,
        available
    });
    return {
        technicians: roster.map((e) => mapTech(e, free.some((f) => Number(f.id) === Number(e.id)))),
        available: free.map((e) => mapTech(e, true)),
        date: day,
        time: startHm
    };
}

async function listAppointments(pool, { from, to, jobType, includeTechnician } = {}) {
    if (!pool) return { appointments: [], stub: true };
    const where = [];
    const params = [];
    if (from) {
        where.push('starts_at >= ?');
        params.push(from);
    }
    if (to) {
        where.push('starts_at <= ?');
        params.push(to);
    }
    if (jobType) {
        where.push('job_type = ?');
        params.push(normalizeJobType(jobType));
    }
    const sql = `SELECT * FROM pos_shop_appointments ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY starts_at ASC LIMIT 500`;
    const [rows] = await pool.execute(sql, params);
    const map = includeTechnician ? rowToAppt : rowToPublicAppt;
    return { appointments: (rows || []).map(map) };
}

async function createAppointment(pool, body = {}) {
    if (!pool) return { appointment: null, stub: true };
    const day = String(
        body.date || String(body.startsAt || body.startAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    ).slice(0, 10);
    const startTime = normalizeHm(
        body.startTime || body.time || String(body.startsAt || body.startAt || '').slice(11, 16) || '09:00'
    );
    const durationMins = Math.max(15, Number(body.durationMins) || DEFAULT_SLOT_MINUTES);
    const startsAt = body.startsAt || body.starts_at || `${day}T${startTime}:00`;
    const endDate = new Date(`${day}T${startTime}:00`);
    endDate.setMinutes(endDate.getMinutes() + durationMins);
    const endsAt =
        body.endsAt ||
        body.ends_at ||
        `${day}T${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;
    const jobType = normalizeJobType(body.jobType || body.job_type || 'auto');

    const bay = await resolveBay(pool, {
        ...body,
        date: day,
        startTime,
        durationMins,
        jobType
    });

    const tech = await resolveTechnicianOptional(
        pool,
        { ...body, date: day, startTime, durationMins },
        bay
    );

    const [result] = await pool.execute(
        `INSERT INTO pos_shop_appointments
         (job_type, bay, starts_at, ends_at, customer_name, phone, email, vehicle, vin, notes, job_id, status, technician_id, technician_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            jobType,
            bay || null,
            startsAt,
            endsAt,
            String(body.customerName || body.customer_name || '').trim() || 'Customer',
            String(body.phone || '').trim() || null,
            String(body.email || '').trim() || null,
            String(body.vehicle || '').trim() || null,
            String(body.vin || '').trim() || null,
            String(body.notes || '').trim() || null,
            body.jobId || body.job_id || null,
            String(body.status || 'scheduled'),
            tech?.id ? Number(tech.id) : null,
            tech?.name || null
        ]
    );
    const [rows] = await pool.execute('SELECT * FROM pos_shop_appointments WHERE id = ?', [result.insertId]);
    return { appointment: rowToPublicAppt(rows[0]) };
}

async function updateAppointment(pool, id, patch = {}) {
    if (!pool) return { appointment: null, stub: true };
    const [rows] = await pool.execute('SELECT * FROM pos_shop_appointments WHERE id = ?', [id]);
    if (!rows.length) return { appointment: null, error: 'Not found' };
    const cur = rowToAppt(rows[0]);
    const next = {
        jobType: patch.jobType != null ? normalizeJobType(patch.jobType) : cur.jobType,
        bay: patch.bay !== undefined ? patch.bay : cur.bay,
        startsAt: patch.startsAt ?? cur.startsAt,
        endsAt: patch.endsAt ?? cur.endsAt,
        customerName: patch.customerName ?? cur.customerName,
        phone: patch.phone ?? cur.phone,
        email: patch.email ?? cur.email,
        vehicle: patch.vehicle ?? cur.vehicle,
        vin: patch.vin ?? cur.vin,
        notes: patch.notes ?? cur.notes,
        jobId: patch.jobId !== undefined ? patch.jobId : cur.jobId,
        status: patch.status ?? cur.status,
        technicianId: patch.technicianId !== undefined ? patch.technicianId : cur.technicianId,
        technicianName: patch.technicianName !== undefined ? patch.technicianName : cur.technicianName
    };
    await pool.execute(
        `UPDATE pos_shop_appointments SET
           job_type=?, bay=?, starts_at=?, ends_at=?, customer_name=?, phone=?, email=?,
           vehicle=?, vin=?, notes=?, job_id=?, status=?, technician_id=?, technician_name=?
         WHERE id=?`,
        [
            next.jobType,
            next.bay || null,
            next.startsAt,
            next.endsAt,
            next.customerName,
            next.phone || null,
            next.email || null,
            next.vehicle || null,
            next.vin || null,
            next.notes || null,
            next.jobId || null,
            next.status,
            next.technicianId != null && next.technicianId !== '' ? Number(next.technicianId) : null,
            next.technicianName || null,
            id
        ]
    );
    const [updated] = await pool.execute('SELECT * FROM pos_shop_appointments WHERE id = ?', [id]);
    return { appointment: rowToPublicAppt(updated[0]) };
}

module.exports = {
    listAppointments,
    createAppointment,
    updateAppointment,
    getAvailableTechnicians,
    getBayAvailability,
    resolveBay,
    rowToAppt,
    rowToPublicAppt,
    parseJson
};
