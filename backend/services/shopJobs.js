'use strict';

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

function rowToJob(row) {
    if (!row) return null;
    const data = parseJson(row.job_data_json, {}) || {};
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
        customerWorkflow: cw,
        paymentTransactionId: row.payment_transaction_id || null,
        lines: data.lines || [],
        checklist: data.checklist || [],
        bay: data.bay || '',
        insurer: data.insurer || '',
        claimNumber: data.claimNumber || '',
        adjuster: data.adjuster || '',
        deductible: data.deductible || 0,
        material: data.material || '',
        color: data.color || '',
        tireSize: data.tireSize || '',
        tireBrand: data.tireBrand || '',
        tireQty: data.tireQty || 0,
        tpms: Boolean(data.tpms),
        deposit: data.deposit || 0,
        mileage: data.mileage || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function jobToPayload(job) {
    const jobType = job.jobType || job.mode || 'auto';
    const data = {
        lines: job.lines || [],
        checklist: job.checklist || [],
        bay: job.bay || '',
        insurer: job.insurer || '',
        claimNumber: job.claimNumber || '',
        adjuster: job.adjuster || '',
        deductible: Number(job.deductible) || 0,
        material: job.material || '',
        color: job.color || '',
        tireSize: job.tireSize || '',
        tireBrand: job.tireBrand || '',
        tireQty: Number(job.tireQty) || 0,
        tpms: Boolean(job.tpms),
        deposit: Number(job.deposit) || 0,
        mileage: job.mileage || '',
        alignmentType: job.alignmentType || 'none'
    };
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
        alignment_type: job.alignmentType || null,
        alignment_done: job.alignmentDone ? 1 : 0,
        alignment_skipped: job.alignmentSkipped ? 1 : 0,
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

async function createJob(pool, payload, _context = {}) {
    if (!pool) return { job: null, stub: true, message: 'Database unavailable' };
    const job = { ...payload };
    if (!job.portalToken) job.portalToken = workflow.createPortalToken(job.id || Date.now());
    const row = jobToPayload(job);
    const [result] = await pool.execute(
        `INSERT INTO pos_shop_jobs
         (portal_token, ro_number, job_type, status, customer_name, phone, email, vehicle, concern,
          total, approved, paid, alignment_type, alignment_done, alignment_skipped,
          customer_workflow_json, job_data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const row = jobToPayload(merged);
    await pool.execute(
        `UPDATE pos_shop_jobs SET
           ro_number = ?, job_type = ?, status = ?, customer_name = ?, phone = ?, email = ?,
           vehicle = ?, concern = ?, total = ?, approved = ?, paid = ?,
           alignment_type = ?, alignment_done = ?, alignment_skipped = ?,
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
    const patch = {
        approved,
        status: approved ? 'waiting_parts' : job.status,
        customerWorkflow: {
            ...(job.customerWorkflow || {}),
            decisionAt: new Date().toISOString(),
            approved,
            notes: String(payload.notes || '').trim()
        }
    };
    return updateJob(pool, job.dbId, patch);
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

module.exports = {
    listJobs,
    getJob,
    getJobByPortalToken,
    createJob,
    updateJob,
    recordCustomerDecision,
    markJobPaid,
    rowToJob
};
