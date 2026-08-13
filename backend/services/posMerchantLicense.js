'use strict';

const logger = require('../utils/logger');
const { calculateMonthlyAmount, describeMonthlyPricing, describeBillingBreakdown } = require('./posBillingPricing');
const { isPlatformBillingConfigured } = require('../utils/platformBillingEnv');
const { billingPortalUrl, sendPaymentFailedEmail, sendGraceEndedEmail, sendPaymentSucceededEmail, sendPastDueWaivedEmail } = require('./posBillingEmail');
const { revokeAllDevices } = require('./posDeviceRegistry');

const LICENSE_ID = 1;
const VALID_STATUSES = new Set(['trial', 'active', 'past_due', 'canceled']);

function isLicenseEnforcementEnabled() {
    return String(process.env.POS_LICENSE_ENFORCE || '').trim().toLowerCase() === 'true';
}

function isBillingDryRun() {
    const s = String(process.env.POS_BILLING_DRY_RUN ?? 'true').trim().toLowerCase();
    return s !== 'false' && s !== '0' && s !== 'no';
}

function shouldRevokeDevicesOnCancel() {
    const s = String(process.env.POS_REVOKE_DEVICES_ON_CANCEL ?? 'true').trim().toLowerCase();
    return s !== 'false' && s !== '0' && s !== 'no';
}

function getDefaultGraceDays() {
    return Math.max(0, Number(process.env.POS_LICENSE_GRACE_DAYS) || 15);
}

function getMaxBillingRetries() {
    return Math.max(0, Number(process.env.POS_BILLING_MAX_RETRIES) || 3);
}

function todayDateString(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function parseDateOnly(value) {
    if (!value) return null;
    const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

function getEffectiveGraceDays(license) {
    const override = license?.graceDaysOverride;
    if (override != null && Number.isFinite(Number(override))) {
        return Math.max(0, Math.floor(Number(override)));
    }
    return getDefaultGraceDays();
}

function isCompedActive(license) {
    const until = parseDateOnly(license?.serviceCompedUntil);
    if (!until) return false;
    const today = parseDateOnly(todayDateString());
    return until >= today;
}

function getGraceEndsAt(license) {
    if (!license?.pastDueSince) return null;
    const since = new Date(license.pastDueSince);
    if (Number.isNaN(since.getTime())) return null;
    return addDays(since, getEffectiveGraceDays(license));
}

function isWithinGracePeriod(license) {
    if (String(license?.status || '').toLowerCase() !== 'past_due') return false;
    const ends = getGraceEndsAt(license);
    if (!ends) return false;
    return ends >= new Date();
}

function getPastDueOwed(license) {
    if (String(license?.status || '').toLowerCase() !== 'past_due') return 0;
    const last = Number(license.lastBillAmount);
    if (last > 0) return Math.round(last * 100) / 100;
    return calculateMonthlyAmount(license.licensedStationCount || 1);
}

function mapLicenseRow(row) {
    if (!row) return null;
    const licensedStationCount = Math.max(1, Number(row.licensed_station_count) || 1);
    const failoverGbUsed = Math.max(0, Number(row.failover_gb_used) || 0);
    const pricing = describeBillingBreakdown(licensedStationCount, failoverGbUsed);
    const serviceCompedUntil = row.service_comped_until
        ? String(row.service_comped_until).slice(0, 10)
        : null;
    const pastDueSince = row.past_due_since || null;
    const graceDaysOverride =
        row.grace_days_override != null ? Number(row.grace_days_override) : null;
    const license = {
        id: row.id,
        status: row.status,
        licensedStationCount,
        failoverGbUsed,
        businessName: row.business_name || '',
        billingEmail: row.billing_email || '',
        paymentMethodType: row.payment_method_type || 'none',
        hasBillingVault: Boolean(
            row.procharge_token ||
                (row.epi_customer_vault_id && row.epi_billing_id) ||
                row.billing_account_id
        ),
        billingAuthorizedAt: row.billing_authorized_at,
        licenseExpiresAt: row.license_expires_at,
        nextBillDate: row.next_bill_date ? String(row.next_bill_date).slice(0, 10) : null,
        lastBillAmount: row.last_bill_amount != null ? Number(row.last_bill_amount) : null,
        lastBillStatus: row.last_bill_status || null,
        lastBillAt: row.last_bill_at,
        notes: row.notes || '',
        serviceCompedUntil,
        pastDueSince,
        billingRetryCount: Number(row.billing_retry_count) || 0,
        nextBillingRetryAt: row.next_billing_retry_at
            ? String(row.next_billing_retry_at).slice(0, 10)
            : null,
        graceDaysOverride,
        monthlyAmount: pricing.monthlyAmount,
        subscriptionAmount: pricing.subscriptionAmount,
        failoverOverageAmount: pricing.failoverOverageAmount,
        pricingSummary: pricing.summary,
        monthlyFormatted: pricing.formatted,
        failoverIncludedGb: pricing.failover.includedGb,
        enforcementEnabled: isLicenseEnforcementEnabled(),
        platformBillingConfigured: isPlatformBillingConfigured(),
        billingDryRun: isBillingDryRun(),
        graceDays: getEffectiveGraceDays({
            graceDaysOverride
        }),
        isComped: isCompedActive({ serviceCompedUntil }),
        inGracePeriod: false,
        graceEndsAt: null,
        billingPortalUrl: billingPortalUrl()
    };
    license.inGracePeriod = isWithinGracePeriod(license);
    const graceEnd = getGraceEndsAt(license);
    license.graceEndsAt = graceEnd ? graceEnd.toISOString() : null;
    const access = getLicenseAccessState(license);
    license.writable = access.writable;
    license.warningMessage = access.warningMessage;
    license.pastDueOwed =
        String(license.status).toLowerCase() === 'past_due' ? getPastDueOwed(license) : 0;
    return license;
}

function getLicenseAccessState(license) {
    if (!license) {
        return {
            writable: false,
            code: 'POS_LICENSE_MISSING',
            message: 'POS license not configured.',
            warningMessage: null
        };
    }

    if (isCompedActive(license)) {
        return {
            writable: true,
            warningMessage: license.serviceCompedUntil
                ? `Service comped at no charge through ${license.serviceCompedUntil}.`
                : null
        };
    }

    const status = String(license.status || '').toLowerCase();

    if (status === 'canceled') {
        return {
            writable: false,
            code: 'POS_LICENSE_CANCELED',
            message: 'Business One POS subscription is canceled. Update billing to restore service.',
            warningMessage: null
        };
    }

    if (status === 'past_due') {
        if (isWithinGracePeriod(license)) {
            const graceEnd = getGraceEndsAt(license);
            const dateLabel = graceEnd ? graceEnd.toLocaleDateString() : 'soon';
            return {
                writable: true,
                warningMessage: `Payment is past due. Update billing by ${dateLabel} to avoid interruption.`,
                inGracePeriod: true
            };
        }
        return {
            writable: false,
            code: 'POS_LICENSE_PAST_DUE',
            message: `Payment is past due. Update billing at ${license.billingPortalUrl || billingPortalUrl()} to continue syncing sales.`,
            warningMessage: null
        };
    }

    if (license.licenseExpiresAt) {
        const exp = new Date(license.licenseExpiresAt);
        if (!Number.isNaN(exp.getTime()) && exp < new Date()) {
            return {
                writable: false,
                code: 'POS_LICENSE_EXPIRED',
                message: 'Business One POS license has expired. Renew billing to continue.',
                warningMessage: null
            };
        }
    }

    if (['trial', 'active'].includes(status)) {
        return { writable: true, warningMessage: null };
    }

    return {
        writable: false,
        code: 'POS_LICENSE_INACTIVE',
        message: 'Business One POS is not active.',
        warningMessage: null
    };
}

function isLicenseWritable(license) {
    const access = getLicenseAccessState(license);
    if (access.writable) {
        return { ok: true, warningMessage: access.warningMessage || null, inGracePeriod: Boolean(access.inGracePeriod) };
    }
    return {
        ok: false,
        code: access.code || 'POS_LICENSE_INACTIVE',
        message: access.message || 'Business One POS is not active.'
    };
}

async function ensureLicenseRow(pool) {
    const [rows] = await pool.execute(`SELECT * FROM pos_merchant_license WHERE id = ? LIMIT 1`, [LICENSE_ID]);
    if (rows[0]) return rows[0];
    const trialDays = Math.max(1, Number(process.env.POS_TRIAL_DAYS) || 14);
    const expires = new Date();
    expires.setDate(expires.getDate() + trialDays);
    await pool.execute(
        `INSERT INTO pos_merchant_license
         (id, status, licensed_station_count, license_expires_at, next_bill_date)
         VALUES (?, 'trial', 1, ?, ?)`,
        [LICENSE_ID, expires, expires.toISOString().slice(0, 10)]
    );
    const [created] = await pool.execute(`SELECT * FROM pos_merchant_license WHERE id = ? LIMIT 1`, [LICENSE_ID]);
    return created[0];
}

async function loadMerchantLicense(pool) {
    const row = await ensureLicenseRow(pool);
    let failoverGbUsed = Math.max(0, Number(row.failover_gb_used) || 0);
    try {
        const { getMeteredFailoverGb, resolveBillingAccountId } = require('./posFailoverMetering');
        const accountId = await resolveBillingAccountId(pool, { accountId: row.billing_account_id });
        failoverGbUsed = await getMeteredFailoverGb(pool, accountId);
    } catch {
        /* metering table optional during migration */
    }
    return mapLicenseRow({ ...row, failover_gb_used: failoverGbUsed });
}

async function countActiveDevices(pool) {
    const [rows] = await pool.execute(`SELECT COUNT(*) AS c FROM pos_devices WHERE is_active = 1`);
    return Number(rows[0]?.c) || 0;
}

async function assertCanWritePos(pool) {
    if (!isLicenseEnforcementEnabled()) {
        return { ok: true, enforced: false };
    }
    const license = await loadMerchantLicense(pool);
    const gate = isLicenseWritable(license);
    if (!gate.ok) return { ...gate, enforced: true, license };
    const activeDevices = await countActiveDevices(pool);
    if (activeDevices > license.licensedStationCount) {
        return {
            ok: false,
            enforced: true,
            code: 'POS_STATION_LIMIT',
            message: `Too many active registers (${activeDevices}) for licensed stations (${license.licensedStationCount}). Add stations in admin.`,
            license
        };
    }
    return {
        ok: true,
        enforced: true,
        license,
        warningMessage: gate.warningMessage || null,
        inGracePeriod: Boolean(gate.inGracePeriod)
    };
}

async function assertCanAddDevice(pool) {
    const license = await loadMerchantLicense(pool);
    const activeDevices = await countActiveDevices(pool);
    if (activeDevices >= license.licensedStationCount) {
        if (!isLicenseEnforcementEnabled()) {
            return {
                ok: true,
                warning: `You have ${activeDevices} active register(s) but only ${license.licensedStationCount} licensed station(s). Enforcement is off until POS_LICENSE_ENFORCE=true.`,
                license
            };
        }
        return {
            ok: false,
            code: 'POS_STATION_LIMIT',
            message: `All ${license.licensedStationCount} licensed station(s) are in use. Increase licensed stations before adding another register.`,
            license
        };
    }
    const gate = isLicenseWritable(license);
    if (!gate.ok && isLicenseEnforcementEnabled()) {
        return { ...gate, license };
    }
    return { ok: true, license };
}

async function handleCanceledStatus(pool) {
    if (!shouldRevokeDevicesOnCancel()) return { revoked: 0 };
    const count = await revokeAllDevices(pool);
    if (count > 0) {
        logger.info('[pos-billing] Revoked POS device keys after cancellation', { count });
    }
    return { revoked: count };
}

async function updateMerchantLicense(pool, patch) {
    await ensureLicenseRow(pool);
    const fields = [];
    const values = [];
    let becomingCanceled = false;

    if (patch.status != null) {
        const status = String(patch.status).toLowerCase();
        if (!VALID_STATUSES.has(status)) {
            const err = new Error('Invalid license status');
            err.code = 'INVALID_STATUS';
            throw err;
        }
        fields.push('status = ?');
        values.push(status);
        becomingCanceled = status === 'canceled';
    }
    if (patch.licensedStationCount != null) {
        const n = Math.max(1, Math.min(99, Math.floor(Number(patch.licensedStationCount) || 1)));
        fields.push('licensed_station_count = ?');
        values.push(n);
    }
    if (patch.businessName !== undefined) {
        fields.push('business_name = ?');
        values.push(String(patch.businessName || '').trim().slice(0, 200) || null);
    }
    if (patch.billingEmail !== undefined) {
        fields.push('billing_email = ?');
        values.push(String(patch.billingEmail || '').trim().slice(0, 255) || null);
    }
    if (patch.notes !== undefined) {
        fields.push('notes = ?');
        values.push(String(patch.notes || '').trim().slice(0, 2000) || null);
    }
    if (patch.licenseExpiresAt !== undefined) {
        fields.push('license_expires_at = ?');
        values.push(patch.licenseExpiresAt || null);
    }
    if (patch.nextBillDate !== undefined) {
        fields.push('next_bill_date = ?');
        values.push(patch.nextBillDate || null);
    }
    if (patch.serviceCompedUntil !== undefined) {
        fields.push('service_comped_until = ?');
        values.push(patch.serviceCompedUntil || null);
    }
    if (patch.graceDaysOverride !== undefined) {
        const g = patch.graceDaysOverride;
        fields.push('grace_days_override = ?');
        values.push(g === '' || g == null ? null : Math.max(0, Math.min(30, Math.floor(Number(g) || 0))));
    }

    if (!fields.length) {
        return loadMerchantLicense(pool);
    }

    values.push(LICENSE_ID);
    await pool.execute(
        `UPDATE pos_merchant_license SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
    );

    if (becomingCanceled) {
        await handleCanceledStatus(pool);
    }

    const license = await loadMerchantLicense(pool);
    if (patch.licensedStationCount != null) {
        try {
            const { ensureDefaultAccount, upsertSubscription } = require('./platformBillingAccount');
            const account = await ensureDefaultAccount(pool);
            await upsertSubscription(pool, account.id, 'pos', {
                status: 'active',
                config: {
                    stationCount: license.licensedStationCount
                }
            });
        } catch {
            /* platform billing optional during migration */
        }
    }

    return license;
}

async function waivePastDuePayment(pool, { note, notify = true } = {}) {
    await ensureLicenseRow(pool);
    const license = await loadMerchantLicense(pool);
    if (String(license.status).toLowerCase() !== 'past_due') {
        const err = new Error('Past due waiver is only available when the account is past due.');
        err.code = 'NOT_PAST_DUE';
        throw err;
    }

    const owed = getPastDueOwed(license);
    if (owed <= 0) {
        const err = new Error('No past due amount to waive.');
        err.code = 'NO_AMOUNT_OWED';
        throw err;
    }

    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const line = `[${stamp}] Past due waived $${owed.toFixed(2)}${note ? `: ${String(note).trim().slice(0, 200)}` : ''}`;
    const newNotes = [license.notes, line].filter(Boolean).join('\n').slice(-2000);

    const { firstOfNextMonth, todayDateString: calToday } = require('./platformBillingCalendar');
    const nextBill = calToday(firstOfNextMonth());
    await pool.execute(
        `UPDATE pos_merchant_license SET
            status = 'active',
            last_bill_amount = ?,
            last_bill_status = 'waived',
            last_bill_at = CURRENT_TIMESTAMP,
            license_expires_at = ?,
            next_bill_date = ?,
            notes = ?,
            past_due_since = NULL,
            billing_retry_count = 0,
            next_billing_retry_at = NULL,
            grace_ended_email_at = NULL,
            last_payment_failed_email_at = NULL,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [owed, nextBill, nextBill, newNotes, LICENSE_ID]
    );

    const updated = await loadMerchantLicense(pool);
    if (notify) {
        await sendPastDueWaivedEmail(updated, { amount: owed, reason: note || '' });
    }
    return updated;
}

async function saveBillingVault(pool, payload) {
    const {
        paymentToken,
        billingEmail,
        businessName,
        paymentMethodType = 'card',
        cardNumber,
        ccExpMonth,
        ccExpYear,
        cvv,
        bankAccount
    } = payload || {};

    const { ensureDefaultAccount, getAccountById, savePaymentMethod, upsertSubscription } =
        require('./platformBillingAccount');

    const account = payload?.accountId
        ? await getAccountById(pool, payload.accountId)
        : await ensureDefaultAccount(pool);
    if (!account) {
        const err = new Error('Billing account not found');
        err.code = 'ACCOUNT_NOT_FOUND';
        throw err;
    }
    const saved = await savePaymentMethod(pool, account.id, {
        paymentToken,
        paymentMethodType,
        billingEmail,
        businessName,
        cardNumber,
        ccExpMonth,
        ccExpYear,
        cvv,
        bankAccount
    });

    await ensureLicenseRow(pool);
    await pool.execute(
        `UPDATE pos_merchant_license SET
            billing_account_id = ?,
            procharge_token = ?,
            payment_method_type = ?,
            billing_email = COALESCE(?, billing_email),
            business_name = COALESCE(?, business_name),
            billing_authorized_at = CURRENT_TIMESTAMP,
            status = CASE WHEN status = 'canceled' THEN 'active' ELSE status END,
            past_due_since = NULL,
            billing_retry_count = 0,
            next_billing_retry_at = NULL,
            grace_ended_email_at = NULL,
            last_payment_failed_email_at = NULL,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            account.id,
            saved.paymentMethodType === 'card' ? saved.prochargeToken : null,
            saved.paymentMethodType,
            billingEmail ? String(billingEmail).trim().slice(0, 255) : null,
            businessName ? String(businessName).trim().slice(0, 200) : null,
            LICENSE_ID
        ]
    );

    const license = await loadMerchantLicense(pool);
    await upsertSubscription(pool, account.id, 'pos', {
        status: 'active',
        config: {
            stationCount: license.licensedStationCount
        }
    });

    return { license, accountId: account.id };
}

function computeChargeBreakdown(license) {
    const gb = Math.max(0, Number(license.failoverGbUsed) || 0);
    const breakdown = describeBillingBreakdown(license.licensedStationCount, gb);
    return {
        subscription: breakdown.subscriptionAmount,
        failoverOverage: breakdown.failoverOverageAmount,
        failoverGbUsed: gb,
        gross: breakdown.monthlyAmount,
        creditApplied: 0,
        chargeAmount: breakdown.monthlyAmount
    };
}

async function recordChargeSuccess(pool, { grossAmount, billingAnchorDate } = {}) {
    const { firstOfNextMonth, todayDateString: calToday } = require('./platformBillingCalendar');
    const nextBill = calToday(firstOfNextMonth(billingAnchorDate || new Date()));
    const renew = nextBill;
    await pool.execute(
        `UPDATE pos_merchant_license SET
            status = 'active',
            last_bill_amount = ?,
            last_bill_status = 'paid',
            last_bill_at = CURRENT_TIMESTAMP,
            license_expires_at = ?,
            next_bill_date = ?,
            past_due_since = NULL,
            billing_retry_count = 0,
            next_billing_retry_at = NULL,
            grace_ended_email_at = NULL,
            failover_gb_used = 0,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [grossAmount, renew, nextBill, LICENSE_ID]
    );
}

async function recordChargeFailure(pool, license, { grossAmount }) {
    const retryCount = (Number(license.billingRetryCount) || 0) + 1;
    const nextRetry = todayDateString(addDays(new Date(), 1));
    await pool.execute(
        `UPDATE pos_merchant_license SET
            status = 'past_due',
            last_bill_amount = ?,
            last_bill_status = 'failed',
            last_bill_at = CURRENT_TIMESTAMP,
            past_due_since = COALESCE(past_due_since, CURRENT_TIMESTAMP),
            billing_retry_count = ?,
            next_billing_retry_at = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [grossAmount, retryCount, nextRetry, LICENSE_ID]
    );
}

async function maybeSendPaymentFailedEmail(pool, license, { amount }) {
    const [rows] = await pool.execute(
        `SELECT last_payment_failed_email_at FROM pos_merchant_license WHERE id = ?`,
        [LICENSE_ID]
    );
    const lastSent = rows[0]?.last_payment_failed_email_at;
    if (lastSent) {
        const last = new Date(lastSent);
        const hoursSince = (Date.now() - last.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 20) return;
    }
    const refreshed = await loadMerchantLicense(pool);
    await sendPaymentFailedEmail(refreshed, {
        amount,
        graceDays: refreshed.graceDays,
        inGrace: refreshed.inGracePeriod
    });
    await pool.execute(
        `UPDATE pos_merchant_license SET last_payment_failed_email_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [LICENSE_ID]
    );
}

async function syncPosSubscriptionFromLicense(pool, license) {
    const { ensureDefaultAccount, upsertSubscription } = require('./platformBillingAccount');
    const account = await ensureDefaultAccount(pool);
    await upsertSubscription(pool, account.id, 'pos', {
        status: 'active',
        config: {
            stationCount: license.licensedStationCount
        }
    });
    return account.id;
}

async function syncLicenseFromAccount(pool, accountId) {
    const { getAccountById } = require('./platformBillingAccount');
    const account = await getAccountById(pool, accountId);
    if (!account) return loadMerchantLicense(pool);
    await pool.execute(
        `UPDATE pos_merchant_license SET
            status = ?,
            last_bill_amount = ?,
            last_bill_status = ?,
            last_bill_at = ?,
            next_bill_date = ?,
            past_due_since = ?,
            billing_retry_count = ?,
            next_billing_retry_at = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            account.status,
            account.lastBillAmount,
            account.lastBillStatus,
            account.lastBillAt,
            account.nextBillDate,
            account.pastDueSince,
            account.billingRetryCount,
            account.nextBillingRetryAt,
            LICENSE_ID
        ]
    );
    return loadMerchantLicense(pool);
}

async function attemptMerchantCharge(pool, license, { reason = 'monthly', force = false } = {}) {
    const dryRun = isBillingDryRun();
    const { gross, chargeAmount, subscription, failoverOverage, failoverGbUsed: gbUsed } =
        computeChargeBreakdown(license);

    if (!license.hasBillingVault) {
        return {
            skipped: true,
            reason: 'no_vault',
            amount: gross,
            subscription,
            failoverOverage,
            failoverGbUsed: gbUsed,
            chargeAmount,
            dryRun
        };
    }

    const accountId = await syncPosSubscriptionFromLicense(pool, {
        ...license,
        failoverGbUsed: gbUsed
    });
    const { chargeAccount } = require('./platformBillingRunner');
    const result = await chargeAccount(pool, accountId, { reason, force });

    if (result.skipped && result.reason === 'dry_run') {
        return {
            skipped: true,
            reason: 'dry_run',
            amount: result.amount ?? gross,
            subscription,
            failoverOverage,
            failoverGbUsed: gbUsed,
            chargeAmount: result.amount ?? gross,
            dryRun: true,
            message: result.message
        };
    }

    if (result.skipped) {
        return {
            ...result,
            subscription,
            failoverOverage,
            failoverGbUsed: gbUsed,
            dryRun
        };
    }

    const updated = await syncLicenseFromAccount(pool, accountId);

    if (result.ok) {
        await pool.execute(`UPDATE pos_merchant_license SET failover_gb_used = 0 WHERE id = ?`, [LICENSE_ID]);
        return {
            ok: true,
            amount: result.amount ?? gross,
            subscription,
            failoverOverage,
            failoverGbUsed: gbUsed,
            chargedAmount: result.chargedAmount ?? result.amount,
            transactionId: result.transactionId,
            license: await loadMerchantLicense(pool)
        };
    }

    await maybeSendPaymentFailedEmail(pool, updated, { amount: result.amount ?? chargeAmount });
    return {
        ok: false,
        amount: result.amount ?? gross,
        subscription,
        failoverOverage,
        failoverGbUsed: gbUsed,
        chargedAmount: result.amount ?? chargeAmount,
        responseText: result.responseText,
        code: result.code || 'CHARGE_FAILED',
        license: updated
    };
}

async function runMonthlyBillingForMerchant(pool, { force = false } = {}) {
    try {
        const { ensureDefaultAccount } = require('./platformBillingAccount');
        const { refreshFailoverBillingForAccount } = require('./posFailoverMetering');
        const account = await ensureDefaultAccount(pool);
        await refreshFailoverBillingForAccount(pool, account.id);
    } catch {
        /* platform billing optional during migration */
    }

    const license = await loadMerchantLicense(pool);
    const { gross: amount, subscription, failoverOverage } = computeChargeBreakdown(license);
    const dryRun = isBillingDryRun();

    if (isCompedActive(license)) {
        return {
            skipped: true,
            reason: 'comped',
            amount,
            subscription,
            failoverOverage,
            compedUntil: license.serviceCompedUntil,
            dryRun
        };
    }

    const today = todayDateString();
    if (!force && license.nextBillDate && license.nextBillDate > today) {
        return {
            skipped: true,
            reason: 'not_due',
            amount,
            subscription,
            failoverOverage,
            nextBillDate: license.nextBillDate,
            dryRun
        };
    }

    return attemptMerchantCharge(pool, license, {
        reason: force ? 'manual' : 'monthly',
        force
    });
}

async function processBillingRetries(pool) {
    const license = await loadMerchantLicense(pool);
    if (String(license.status).toLowerCase() !== 'past_due') {
        return { skipped: true, reason: 'not_past_due' };
    }
    if (isCompedActive(license)) {
        return { skipped: true, reason: 'comped' };
    }
    const today = todayDateString();
    if (license.nextBillingRetryAt && license.nextBillingRetryAt > today) {
        return { skipped: true, reason: 'retry_not_due', nextRetry: license.nextBillingRetryAt };
    }
    if (license.billingRetryCount >= getMaxBillingRetries()) {
        return { skipped: true, reason: 'max_retries', count: license.billingRetryCount };
    }
    return attemptMerchantCharge(pool, license, { reason: 'retry' });
}

async function processGraceExpiration(pool) {
    const license = await loadMerchantLicense(pool);
    if (String(license.status).toLowerCase() !== 'past_due') {
        return { skipped: true, reason: 'not_past_due' };
    }
    if (isWithinGracePeriod(license)) {
        return { skipped: true, reason: 'still_in_grace' };
    }

    const [rows] = await pool.execute(
        `SELECT grace_ended_email_at, billing_retry_count FROM pos_merchant_license WHERE id = ?`,
        [LICENSE_ID]
    );
    const row = rows[0] || {};
    let emailSent = false;
    if (!row.grace_ended_email_at) {
        await sendGraceEndedEmail(license);
        await pool.execute(
            `UPDATE pos_merchant_license SET grace_ended_email_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [LICENSE_ID]
        );
        emailSent = true;
    }

    const maxRetries = getMaxBillingRetries();
    if ((Number(row.billing_retry_count) || 0) >= maxRetries) {
        await pool.execute(
            `UPDATE pos_merchant_license SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [LICENSE_ID]
        );
        const revoked = await handleCanceledStatus(pool);
        return {
            canceled: true,
            emailSent,
            revoked: revoked.revoked,
            reason: 'grace_expired_max_retries'
        };
    }

    return { graceExpired: true, emailSent, canceled: false };
}

async function processMerchantBillingMaintenance(pool) {
    const retry = await processBillingRetries(pool);
    const grace = await processGraceExpiration(pool);
    return { retry, grace, monthly: { skipped: true, reason: 'platform_billing_scheduler' } };
}

async function markPastDueFromWebhook(pool, { reason, transactionId }) {
    const license = await loadMerchantLicense(pool);
    const gross = calculateMonthlyAmount(license.licensedStationCount);
    await recordChargeFailure(pool, license, { grossAmount: gross });
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const line = `[${stamp}] ACH return / webhook: ${String(reason || 'payment_failed').slice(0, 120)}${transactionId ? ` (${transactionId})` : ''}`;
    const newNotes = [license.notes, line].filter(Boolean).join('\n').slice(-2000);
    await pool.execute(`UPDATE pos_merchant_license SET notes = ? WHERE id = ?`, [newNotes, LICENSE_ID]);
    const failed = await loadMerchantLicense(pool);
    await maybeSendPaymentFailedEmail(pool, failed, { amount: gross });
    return failed;
}

module.exports = {
    isLicenseEnforcementEnabled,
    isBillingDryRun,
    getDefaultGraceDays,
    getMaxBillingRetries,
    getLicenseAccessState,
    isLicenseWritable,
    getPastDueOwed,
    loadMerchantLicense,
    updateMerchantLicense,
    waivePastDuePayment,
    saveBillingVault,
    countActiveDevices,
    assertCanWritePos,
    assertCanAddDevice,
    runMonthlyBillingForMerchant,
    processBillingRetries,
    processGraceExpiration,
    processMerchantBillingMaintenance,
    markPastDueFromWebhook,
    calculateMonthlyAmount,
    syncLicenseFromAccount
};
