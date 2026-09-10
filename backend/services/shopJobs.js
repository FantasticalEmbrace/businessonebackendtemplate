'use strict';

const { pickJobData } = require('./shopJobDataFields');

function createPortalToken(jobId) {
    const id = String(jobId || Date.now());
    return `trk-${id.replace(/[^a-zA-Z0-9_-]/g, '')}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson(val, fallback = null) {
    if (val == null) return fallback;
    if (typeof val === 'object') return val;
    try {
        return JSON.parse(val);
    } catch {
        return fallback;
    }
}

function stampStage(job, status) {
    const stages = { ...(job.stageTimestamps || {}) };
    const key = String(status || job.status || '');
    if (key && !stages[key]) stages[key] = new Date().toISOString();
    return stages;
}

function rowToJob(row) {
    if (!row) return null;
    const data = pickJobData(parseJson(row.job_data_json, {}) || {});
    const cw = parseJson(row.customer_workflow_json, {}) || {};
    return {
        id: String(row.id),
        dbId: row.id,
        portalToken: row.portal_token,
        roNumber: row.ro_number,
        jobType: row.job_type,
        mode: row.job_type,
        status: row.status,
        customerName: row.customer_name,
        phone: row.phone || '',
        email: row.email || '',
        vehicle: row.vehicle || '',
        concern: row.concern || '',
        total: Number(row.total) || 0,
        approved: Boolean(row.approved),
        paid: Boolean(row.paid),
        alignmentType: row.alignment_type || data.alignmentType || 'none',
        alignmentDone: Boolean(row.alignment_done),
        alignmentSkipped: Boolean(row.alignment_skipped),
        customerId: row.customer_id != null ? Number(row.customer_id) : data.customerId || null,
        appointmentId: row.appointment_id != null ? Number(row.appointment_id) : data.appointmentId || null,
        releasedAt: row.released_at || data.releasedAt || null,
        customerWorkflow: cw,
        paymentTransactionId: row.payment_transaction_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...data
    };
}

function jobToPayload(job) {
    const jobType = job.jobType || job.mode || 'auto';
    const data = pickJobData(job);
    if (job.customerId != null) data.customerId = job.customerId;
    if (job.appointmentId != null) data.appointmentId = job.appointmentId;
    if (job.releasedAt) data.releasedAt = job.releasedAt;
    return {
        portal_token: job.portalToken || createPortalToken(job.id),
        ro_number: String(job.roNumber || job.ro_number || '').trim() || `RO-${Date.now()}`,
        job_type: jobType,
        status: String(job.status || 'estimate'),
        customer_name: String(job.customerName || '').trim() || 'Walk-in customer',
        phone: String(job.phone || '').trim() || null,
        email: String(job.email || '').trim() || null,
        vehicle: String(job.vehicle || '').trim() || null,
        concern: String(job.concern || '').trim() || null,
        total: Math.round((Number(job.total) || 0) * 100) / 100,
        approved: job.approved ? 1 : 0,
        paid: job.paid ? 1 : 0,
        alignment_type: job.alignmentType || data.alignmentType || null,
        alignment_done: job.alignmentDone ? 1 : 0,
        alignment_skipped: job.alignmentSkipped ? 1 : 0,
        customer_id: job.customerId != null ? Number(job.customerId) : null,
        appointment_id: job.appointmentId != null ? Number(job.appointmentId) : null,
        released_at: job.releasedAt || null,
        customer_workflow_json: JSON.stringify(job.customerWorkflow || {}),
        job_data_json: JSON.stringify(data)
    };
}

async function listJobs(pool, filters = {}) {
    if (!pool) return { jobs: [], stub: true, message: 'Database unavailable' };
    const where = [];
    const params = [];
    if (filters.status) {
        where.push('status = ?');
        params.push(String(filters.status));
    }
    if (filters.jobType) {
        where.push('job_type = ?');
        params.push(String(filters.jobType));
    }
    if (filters.inStorage === true || filters.inStorage === '1') {
        where.push(`JSON_EXTRACT(job_data_json, '$.inStorage') = true`);
    }
    if (filters.customerId) {
        where.push('customer_id = ?');
        params.push(Number(filters.customerId));
    }
    const sql = `SELECT * FROM pos_shop_jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 500`;
    const [rows] = await pool.execute(sql, params);
    return { jobs: (rows || []).map(rowToJob) };
}

async function getJob(pool, id) {
    if (!pool) return { job: null, stub: true };
    const key = String(id || '').trim();
    const [rows] = await pool.execute(
        'SELECT * FROM pos_shop_jobs WHERE id = ? OR ro_number = ? OR portal_token = ? LIMIT 1',
        [key, key, key]
    );
    return { job: rowToJob(rows[0]) };
}

async function getJobByPortalToken(pool, token) {
    if (!pool) return { job: null };
    const t = String(token || '').trim();
    if (!t) return { job: null };
    const [rows] = await pool.execute('SELECT * FROM pos_shop_jobs WHERE portal_token = ? LIMIT 1', [t]);
    return { job: rowToJob(rows[0]) };
}

async function findPriorJobsForVehicle(pool, { phone, email, vehicle, excludeId } = {}) {
    if (!pool) return [];
    const where = [];
    const params = [];
    if (phone) {
        where.push('phone = ?');
        params.push(String(phone).trim());
    }
    if (email) {
        where.push('email = ?');
        params.push(String(email).trim().toLowerCase());
    }
    if (!where.length) return [];
    const sql = `SELECT * FROM pos_shop_jobs WHERE (${where.join(' OR ')}) ORDER BY updated_at DESC LIMIT 50`;
    const [rows] = await pool.execute(sql, params);
    let jobs = (rows || []).map(rowToJob);
    if (vehicle) {
        const v = String(vehicle).toLowerCase();
        jobs = jobs.filter((j) => String(j.vehicle || '').toLowerCase().includes(v) || v.includes(String(j.vehicle || '').toLowerCase()));
    }
    if (excludeId) jobs = jobs.filter((j) => String(j.id) !== String(excludeId) && String(j.dbId) !== String(excludeId));
    return jobs;
}

async function createJob(pool, payload, _context = {}) {
    if (!pool) return { job: null, stub: true, message: 'Database unavailable' };
    const job = { ...payload };
    if (!job.portalToken) job.portalToken = createPortalToken(job.id || Date.now());
    job.stageTimestamps = stampStage(job, job.status || 'estimate');
    const row = jobToPayload(job);
    const [result] = await pool.execute(
        `INSERT INTO pos_shop_jobs
         (portal_token, ro_number, job_type, status, customer_name, phone, email, vehicle, concern,
          total, approved, paid, alignment_type, alignment_done, alignment_skipped,
          customer_id, appointment_id, released_at,
          customer_workflow_json, job_data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            row.portal_token,
            row.ro_number,
            row.job_type,
            row.status,
            row.customer_name,
            row.phone,
            row.email,
            row.vehicle,
            row.concern,
            row.total,
            row.approved,
            row.paid,
            row.alignment_type,
            row.alignment_done,
            row.alignment_skipped,
            row.customer_id,
            row.appointment_id,
            row.released_at,
            row.customer_workflow_json,
            row.job_data_json
        ]
    );
    return getJob(pool, result.insertId);
}

async function updateJob(pool, id, patch, _context = {}) {
    if (!pool) return { job: null, stub: true };
    const existing = await getJob(pool, id);
    if (!existing.job) return { job: null, error: 'Job not found' };
    const merged = { ...existing.job, ...(patch || {}) };
    if (patch?.customerWorkflow) {
        merged.customerWorkflow = { ...(existing.job.customerWorkflow || {}), ...patch.customerWorkflow };
    }
    if (patch?.status && patch.status !== existing.job.status) {
        merged.stageTimestamps = stampStage(merged, patch.status);
    }
    if (patch?.status === 'ready' && !merged.releasedAt) {
        // release is separate; ready alone does not set releasedAt
    }
    const row = jobToPayload(merged);
    await pool.execute(
        `UPDATE pos_shop_jobs SET
           ro_number = ?, job_type = ?, status = ?, customer_name = ?, phone = ?, email = ?,
           vehicle = ?, concern = ?, total = ?, approved = ?, paid = ?,
           alignment_type = ?, alignment_done = ?, alignment_skipped = ?,
           customer_id = ?, appointment_id = ?, released_at = ?,
           customer_workflow_json = ?, job_data_json = ?,
           payment_transaction_id = COALESCE(?, payment_transaction_id)
         WHERE id = ?`,
        [
            row.ro_number,
            row.job_type,
            row.status,
            row.customer_name,
            row.phone,
            row.email,
            row.vehicle,
            row.concern,
            row.total,
            row.approved,
            row.paid,
            row.alignment_type,
            row.alignment_done,
            row.alignment_skipped,
            row.customer_id,
            row.appointment_id,
            row.released_at,
            row.customer_workflow_json,
            row.job_data_json,
            patch?.paymentTransactionId || null,
            existing.job.dbId
        ]
    );
    return getJob(pool, existing.job.dbId);
}

async function recordCustomerDecision(pool, portalToken, payload = {}) {
    const result = await getJobByPortalToken(pool, portalToken);
    const job = result.job;
    if (!job) return { job: null, error: 'Job not found' };
    const approved = Boolean(payload.approved);
    const declinedLineIds = Array.isArray(payload.declinedLineIds)
        ? payload.declinedLineIds.map(String)
        : Array.isArray(payload.selectedLineIds) && payload.approved === false
          ? []
          : [];
    const selectedLineIds = Array.isArray(payload.selectedLineIds)
        ? payload.selectedLineIds.map(String)
        : null;

    let lines = Array.isArray(job.lines) ? job.lines.slice() : [];
    if (selectedLineIds) {
        const selected = new Set(selectedLineIds);
        lines = lines.map((line, idx) => {
            const id = String(line.id || line.lineId || idx);
            const keep = selected.has(id);
            return {
                ...line,
                customerApproved: keep,
                customerDeclined: !keep
            };
        });
        const declined = lines.filter((l) => l.customerDeclined).map((l, idx) => String(l.id || l.lineId || idx));
        declinedLineIds.push(...declined);
    }

    const total = lines
        .filter((l) => l.customerDeclined !== true)
        .reduce((sum, l) => sum + Number(l.price || 0) * Number(l.qty || 1), 0);
    const subtotal = Math.round(total * 100) / 100;
    const taxRate = Number(job.taxRate);
    const rate = Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : 0.08;
    const tax = Math.round(subtotal * rate * 100) / 100;

    const patch = {
        approved,
        lines,
        total: subtotal,
        taxRate: rate,
        subtotal,
        tax,
        status: approved ? 'waiting_parts' : job.status,
        ...require('./shopCustomerWorkflow').expandRepairWorkflowPatch(job),
        customerWorkflow: {
            ...(job.customerWorkflow || {}),
            decisionAt: new Date().toISOString(),
            decisionSource: 'portal',
            decisionStatus: approved ? 'approved' : 'declined',
            approved,
            notes: String(payload.notes || '').trim(),
            declinedLineIds: [...new Set(declinedLineIds)],
            partialDecline: declinedLineIds.length > 0 && approved
        }
    };
    return updateJob(pool, job.dbId, patch);
}

async function recordCustomerQuestion(pool, portalToken, question) {
    const result = await getJobByPortalToken(pool, portalToken);
    if (!result.job) return { job: null, error: 'Job not found' };
    return updateJob(pool, result.job.dbId, {
        customerQuestion: String(question || '').trim(),
        customerQuestionAt: new Date().toISOString()
    });
}

async function markJobPaid(pool, portalToken, transactionId) {
    const result = await getJobByPortalToken(pool, portalToken);
    if (!result.job) return { job: null, error: 'Job not found' };
    return updateJob(pool, result.job.dbId, {
        paid: true,
        status: 'ready',
        paymentTransactionId: transactionId || null,
        customerWorkflow: {
            ...(result.job.customerWorkflow || {}),
            paidAt: new Date().toISOString()
        }
    });
}

async function appendJobPhoto(pool, jobId, photo) {
    const existing = await getJob(pool, jobId);
    if (!existing.job) return { job: null, error: 'Job not found' };
    const photos = Array.isArray(existing.job.photos) ? existing.job.photos.slice() : [];
    photos.push({
        id: photo.id || `ph-${Date.now()}`,
        url: photo.url || '',
        caption: photo.caption || '',
        tag: photo.tag || 'intake',
        annotated: Boolean(photo.annotated),
        storage: photo.storage || (photo.driveFileId ? 'drive' : photo.deviceKey ? 'device' : 'server'),
        driveFileId: photo.driveFileId || null,
        deviceKey: photo.deviceKey || null,
        workItemId: photo.workItemId || null,
        createdAt: new Date().toISOString(),
        at: photo.at || new Date().toISOString()
    });
    const patch = { photos };
    if (photo.tag === 'teardown' || photo.tag === 'intake') patch.photosDone = true;
    return updateJob(pool, existing.job.dbId, patch);
}

module.exports = {
    listJobs,
    getJob,
    getJobByPortalToken,
    findPriorJobsForVehicle,
    createJob,
    updateJob,
    recordCustomerDecision,
    recordCustomerQuestion,
    markJobPaid,
    appendJobPhoto,
    rowToJob,
    createPortalToken,
    stampStage
};
