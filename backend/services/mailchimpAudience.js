'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { digitsOnly, formatPhoneForStorage } = require('../utils/usPhoneDisplay');

/** @type {string|null|undefined} undefined = not loaded */
let cachedPhoneMergeTag;
/** @type {string|null} */
let cachedListName = null;
/** @type {'unknown'|'supported'|'unsupported'} */
let smsApiSupport = 'unknown';

function mailchimpConfig() {
    const apiKey = String(process.env.MAILCHIMP_API_KEY || '').trim();
    const audienceId = String(process.env.MAILCHIMP_AUDIENCE_ID || '').trim();
    if (!apiKey || !audienceId) return null;
    const dc =
        String(process.env.MAILCHIMP_SERVER_PREFIX || process.env.SERVER_PREFIX || '').trim() ||
        (apiKey.includes('-') ? apiKey.split('-').pop() : '');
    if (!dc) return null;
    return { apiKey, audienceId, dc };
}

function normalizeEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}

function subscriberHash(email) {
    return crypto.createHash('md5').update(normalizeEmail(email)).digest('hex');
}

function phoneDigits(phone) {
    let digits = digitsOnly(phone);
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    return digits;
}

/** US numbers Mailchimp SMS accepts, as E.164. Null when it is not a 10-digit US number. */
function toUsE164(phone) {
    const digits = phoneDigits(phone);
    if (digits.length !== 10) return null;
    return `+1${digits}`;
}

function phoneForMerge(phone) {
    const display = formatPhoneForStorage(phone);
    if (display) return display;
    const raw = String(phone || '').trim();
    if (phoneDigits(raw).length < 7) return null;
    return raw.slice(0, 50);
}

function phonesMatch(a, b) {
    const da = phoneDigits(a);
    const db = phoneDigits(b);
    return Boolean(da && db && da === db);
}

/**
 * Use an existing phone merge tag only. Never creates one.
 * Prefers the account's PHONE tag, then any merge field whose type is phone.
 */
function pickPhoneMergeTag(mergeFields) {
    const list = Array.isArray(mergeFields) ? mergeFields : [];
    const exact = list.find((field) => String(field?.tag || '').toUpperCase() === 'PHONE');
    if (exact) return String(exact.tag);
    const typed = list.find((field) => String(field?.type || '').toLowerCase() === 'phone');
    if (typed && typed.tag) return String(typed.tag);
    return null;
}

function sanitizeMailchimpDetail(text) {
    return String(text || '')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]')
        .slice(0, 240);
}

function parseErrorBody(text) {
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function errorBlob(text) {
    const parsed = parseErrorBody(text);
    if (!parsed) return String(text || '');
    const parts = [parsed.title, parsed.detail];
    if (Array.isArray(parsed.errors)) {
        for (const err of parsed.errors) {
            parts.push(err?.field, err?.message);
        }
    }
    return parts.filter(Boolean).join(' ');
}

function smsErrorIsUnsupported(status, bodyText) {
    const blob = errorBlob(bodyText);
    if (!/sms/i.test(blob)) return false;
    if (
        /not enabled|not available|does not support|doesn't support|do not support|unsupported|cannot accept|can't accept|not set up|no sms|isn't enabled|is not enabled|must be enabled/i.test(
            blob
        )
    ) {
        return true;
    }
    if (status === 400 && /unknown field|not a valid field|additional propert/i.test(blob)) return true;
    return false;
}

function smsPhoneFormatError(bodyText) {
    const blob = errorBlob(bodyText);
    if (!/sms_phone_number|phone number/i.test(blob)) return false;
    return /invalid|format|must be|not a valid/i.test(blob);
}

function mergeFieldRejected(bodyText, tag) {
    if (!tag) return false;
    const blob = errorBlob(bodyText);
    return new RegExp(tag, 'i').test(blob) && /merge|invalid|blank|format/i.test(blob);
}

function transactionalStatusRejected(bodyText) {
    const blob = errorBlob(bodyText);
    return /transactional/i.test(blob) && /not|invalid|cannot|unavailable|must be/i.test(blob);
}

function smsProgramNotConfigured(bodyText) {
    const blob = errorBlob(bodyText);
    return /sms program country|configured sms program|sms channel operations require/i.test(blob);
}

function smsStatusSaved(value) {
    const status = String(value || '').toLowerCase();
    return status === 'subscribed' || status === 'pending';
}

const EMAIL_OPT_IN_TAG = 'Email opt-in';
const TEXT_OPT_IN_TAG = 'Text opt-in';

/** Tags Aiden can see on the contact. Only the channels this person agreed to. */
function desiredOptInTags({ emailMarketing = false, smsConsent = false } = {}) {
    const tags = [];
    if (emailMarketing) tags.push({ name: EMAIL_OPT_IN_TAG, status: 'active' });
    if (smsConsent) tags.push({ name: TEXT_OPT_IN_TAG, status: 'active' });
    return tags;
}

function memberTagNames(existing) {
    const tags = Array.isArray(existing?.tags) ? existing.tags : [];
    return new Set(tags.map((tag) => String(tag?.name || '').trim().toLowerCase()));
}

function optInTagsMissing(existing, { emailMarketing = false, smsConsent = false } = {}) {
    if (!existing) return true;
    const have = memberTagNames(existing);
    if (emailMarketing && !have.has(EMAIL_OPT_IN_TAG.toLowerCase())) return true;
    if (smsConsent && !have.has(TEXT_OPT_IN_TAG.toLowerCase())) return true;
    return false;
}

/** Merge fields to fill when Mailchimp has a blank name and the store has one. */
function blankNameFields(existing, firstName, lastName) {
    if (!existing) return {};
    const merge = existing.merge_fields || {};
    const fields = {};
    if (firstName && !String(merge.FNAME || '').trim()) fields.FNAME = String(firstName).slice(0, 100);
    if (lastName && !String(merge.LNAME || '').trim()) fields.LNAME = String(lastName).slice(0, 100);
    return fields;
}

function permanentlyDeletedError(bodyText) {
    const blob = errorBlob(bodyText);
    return /forgotten email|permanently deleted|cannot be re-imported/i.test(blob);
}

function errorTitle(bodyText) {
    const parsed = parseErrorBody(bodyText);
    return String(parsed?.title || '')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .slice(0, 80);
}

/**
 * Build the member body for one consent combination.
 * Email marketing status is subscribed only when emailMarketing is true.
 * SMS-only new contacts use transactional so they are on the audience without email campaigns.
 * Existing SMS-only contacts omit status so a prior email subscription is left as-is.
 */
function buildConsentPayload({
    email,
    firstName = null,
    lastName = null,
    phone = null,
    emailMarketing = false,
    smsConsent = false,
    phoneMergeTag = null,
    includePhoneMerge = true,
    includeSmsFields = true,
    smsNumberStyle = 'e164',
    existing = null,
} = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) return null;
    if (!emailMarketing && !smsConsent) return null;

    const merge_fields = {};
    if (firstName) merge_fields.FNAME = String(firstName).slice(0, 100);
    if (lastName) merge_fields.LNAME = String(lastName).slice(0, 100);

    const mergePhone = includePhoneMerge && phoneMergeTag ? phoneForMerge(phone) : null;
    if (mergePhone && phoneMergeTag) merge_fields[phoneMergeTag] = mergePhone;

    const e164 = toUsE164(phone);
    const smsNumber = e164 ? (smsNumberStyle === 'digits' ? e164.slice(2) : e164) : null;
    const wantSms = Boolean(smsConsent && includeSmsFields && smsNumber);

    if (!emailMarketing && !wantSms && !mergePhone) return null;

    const body = { email_address: normalized };
    if (Object.keys(merge_fields).length) body.merge_fields = merge_fields;

    if (emailMarketing) {
        body.status_if_new = 'subscribed';
        body.status = 'subscribed';
    } else if (!existing) {
        body.status_if_new = 'transactional';
        body.status = 'transactional';
    }

    if (wantSms) {
        body.sms_phone_number = smsNumber;
        body.sms_subscription_status = 'subscribed';
    }

    return body;
}

function consentAlreadyApplied(existing, { emailMarketing, smsConsent, phoneMergeTag, phone, requireSmsStatus }) {
    if (!existing) return false;
    if (emailMarketing && String(existing.status || '').toLowerCase() !== 'subscribed') return false;
    if (smsConsent && requireSmsStatus) {
        if (String(existing.sms_subscription_status || '').toLowerCase() !== 'subscribed') return false;
        const e164 = toUsE164(phone);
        if (e164 && existing.sms_phone_number && !phonesMatch(existing.sms_phone_number, e164)) return false;
    }
    if (phoneMergeTag && phoneForMerge(phone)) {
        const current = existing.merge_fields ? existing.merge_fields[phoneMergeTag] : null;
        if (!phonesMatch(current, phone)) return false;
    }
    if (smsConsent && !requireSmsStatus && phoneMergeTag && !phoneForMerge(phone)) return false;
    return true;
}

function authHeaders(cfg) {
    return {
        Authorization: `apikey ${cfg.apiKey}`,
        'Content-Type': 'application/json',
    };
}

async function mailchimpFetch(url, options) {
    const timeoutMs = 12000;
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    const res = await fetch(url, { ...options, signal });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text };
}

async function loadAudienceMeta(cfg) {
    if (cachedPhoneMergeTag !== undefined) {
        return { phoneMergeTag: cachedPhoneMergeTag, listName: cachedListName };
    }
    try {
        const headers = authHeaders(cfg);
        const [listRes, mergeRes] = await Promise.all([
            mailchimpFetch(
                `https://${cfg.dc}.api.mailchimp.com/3.0/lists/${cfg.audienceId}?fields=name`,
                { method: 'GET', headers }
            ),
            mailchimpFetch(
                `https://${cfg.dc}.api.mailchimp.com/3.0/lists/${cfg.audienceId}/merge-fields?count=100`,
                { method: 'GET', headers }
            ),
        ]);
        if (listRes.ok) {
            const list = parseErrorBody(listRes.text);
            cachedListName = list && list.name ? String(list.name) : null;
        }
        if (mergeRes.ok) {
            const parsed = parseErrorBody(mergeRes.text);
            cachedPhoneMergeTag = pickPhoneMergeTag(parsed?.merge_fields);
        } else {
            cachedPhoneMergeTag = null;
            logger.warn('[mailchimp] merge field lookup failed', {
                status: mergeRes.status,
                body: sanitizeMailchimpDetail(mergeRes.text),
            });
        }
    } catch (err) {
        logger.warn('[mailchimp] audience lookup error:', err?.message || err);
        return { phoneMergeTag: null, listName: cachedListName };
    }
    return { phoneMergeTag: cachedPhoneMergeTag, listName: cachedListName };
}

async function getMember(cfg, email) {
    const base = `https://${cfg.dc}.api.mailchimp.com/3.0/lists/${cfg.audienceId}/members/${subscriberHash(email)}`;
    const fullFields = 'status,sms_phone_number,sms_subscription_status,merge_fields,email_address,tags';
    const basicFields = 'status,merge_fields,email_address,tags';
    try {
        let res = await mailchimpFetch(`${base}?fields=${fullFields}`, { method: 'GET', headers: authHeaders(cfg) });
        if (!res.ok && res.status !== 404 && res.status !== 401 && res.status !== 403) {
            if (smsErrorIsUnsupported(res.status, res.text)) smsApiSupport = 'unsupported';
            const basic = await mailchimpFetch(`${base}?fields=${basicFields}`, {
                method: 'GET',
                headers: authHeaders(cfg),
            });
            if (basic.ok || basic.status === 404) res = basic;
        }
        if (res.status === 404) return { ok: false, status: 404, member: null };
        if (!res.ok) {
            logger.warn('[mailchimp] member lookup failed', {
                status: res.status,
                body: sanitizeMailchimpDetail(res.text),
            });
            return { ok: false, status: res.status, member: null };
        }
        return { ok: true, status: res.status, member: parseErrorBody(res.text) };
    } catch (err) {
        logger.warn('[mailchimp] member lookup error:', err?.message || err);
        return { ok: false, status: 0, member: null, error: err?.message || String(err) };
    }
}

/**
 * Audiences API SMS channel. The list-member sms_subscription_status field is
 * accepted by this account and then ignored. This call is what actually sets
 * text consent, and it fails closed when the audience has no SMS program country.
 * Email consent is confirmed only when this order opted into email, or when the
 * contact was already email-subscribed. Text-only uses unknown, which stays off
 * the email marketing list on a single-opt-in audience.
 */
async function applyAudienceSmsConsent(cfg, { email, phone, emailMarketing, preserveExistingEmail, historical }) {
    const smsPhone = toUsE164(phone);
    if (!smsPhone) return { ok: false, reason: 'no_us_phone' };
    const params = new URLSearchParams({
        merge_field_validation_mode: 'ignore_required_checks',
        data_mode: historical ? 'historical' : 'live',
    });
    const url = `https://${cfg.dc}.api.mailchimp.com/3.0/audiences/${cfg.audienceId}/contacts?${params}`;
    const keepEmailSubscribed = Boolean(emailMarketing || preserveExistingEmail);
    const res = await mailchimpFetch(url, {
        method: 'POST',
        headers: authHeaders(cfg),
        body: JSON.stringify({
            update_existing: true,
            email_channel: {
                email,
                marketing_consent: {
                    status: keepEmailSubscribed ? 'confirmed' : 'unknown',
                    ...(keepEmailSubscribed ? { captured_at: new Date().toISOString() } : {}),
                },
            },
            sms_channel: {
                sms_phone: smsPhone,
                marketing_consent: {
                    status: 'confirmed',
                    captured_at: new Date().toISOString(),
                },
            },
        }),
    });
    if (!res.ok) {
        logger.warn('[mailchimp] sms consent failed', {
            status: res.status,
            body: sanitizeMailchimpDetail(res.text),
        });
        return {
            ok: false,
            status: res.status,
            programMissing: smsProgramNotConfigured(res.text),
            error: sanitizeMailchimpDetail(res.text),
        };
    }
    const parsed = parseErrorBody(res.text);
    const smsStatus = String(parsed?.sms_channel?.effective_subscription_status?.value || '').toLowerCase();
    const emailStatus = String(parsed?.email_channel?.effective_subscription_status?.value || '').toLowerCase();
    if (!emailMarketing && !preserveExistingEmail && emailStatus === 'subscribed') {
        return { ok: false, reason: 'email_flipped_on', emailStatus, smsStatus };
    }
    return {
        ok: smsStatusSaved(smsStatus),
        smsStatus,
        emailStatus,
        hasSmsPhone: Boolean(parsed?.sms_channel?.sms_phone),
    };
}

/**
 * Puts Email opt-in / Text opt-in on the contact. Never removes a tag, so a
 * later checkout that only repeats one channel cannot clear the other.
 * Does not change email subscription status.
 */
async function applyOptInTags(cfg, email, { emailMarketing, smsConsent }) {
    const tags = desiredOptInTags({ emailMarketing, smsConsent });
    if (!tags.length) return { ok: true, skipped: true };
    const url = `https://${cfg.dc}.api.mailchimp.com/3.0/lists/${cfg.audienceId}/members/${subscriberHash(email)}/tags`;
    try {
        const res = await mailchimpFetch(url, {
            method: 'POST',
            headers: authHeaders(cfg),
            body: JSON.stringify({ tags }),
        });
        if (!res.ok) {
            logger.warn('[mailchimp] opt-in tag failed', {
                status: res.status,
                body: sanitizeMailchimpDetail(res.text),
            });
            return { ok: false, status: res.status, error: sanitizeMailchimpDetail(res.text) };
        }
        return { ok: true };
    } catch (err) {
        logger.warn('[mailchimp] opt-in tag error:', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    }
}

async function writeMember(cfg, email, body, method) {
    const url = `https://${cfg.dc}.api.mailchimp.com/3.0/lists/${cfg.audienceId}/members/${subscriberHash(email)}`;
    const res = await mailchimpFetch(url, {
        method,
        headers: authHeaders(cfg),
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        logger.warn('[mailchimp] upsert failed', {
            status: res.status,
            body: sanitizeMailchimpDetail(res.text),
        });
    }
    return res;
}

function resultBase(extra) {
    return {
        ok: false,
        already: false,
        added: false,
        skipped: false,
        phoneOnContact: false,
        emailMarketingSet: false,
        smsConsentSet: false,
        tagsSet: false,
        phoneMergeTag: cachedPhoneMergeTag || null,
        listName: cachedListName,
        smsApiSupported: smsApiSupport === 'unknown' ? null : smsApiSupport === 'supported',
        ...extra,
    };
}

/**
 * Upsert one audience member.
 * emailMarketing subscribes them to email campaigns.
 * smsConsent sets Mailchimp SMS subscription fields when the account accepts them,
 * and never turns email marketing on by itself.
 * Failures are returned, not thrown.
 */
async function upsertAudienceMember(
    email,
    {
        firstName = null,
        lastName = null,
        phone = null,
        emailMarketing = false,
        smsConsent = false,
        historical = false,
    } = {}
) {
    const cfg = mailchimpConfig();
    if (!cfg) return resultBase({ skipped: true, reason: 'not_configured' });

    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) {
        return resultBase({ skipped: true, reason: 'invalid_email' });
    }
    if (!emailMarketing && !smsConsent) {
        return resultBase({ skipped: true, reason: 'no_consent' });
    }

    const meta = await loadAudienceMeta(cfg);
    const phoneMergeTag = meta.phoneMergeTag;
    const lookup = await getMember(cfg, normalized);
    if (!lookup.ok && lookup.status !== 404 && !emailMarketing) {
        return resultBase({
            reason: 'lookup_failed',
            phoneMergeTag,
            error: lookup.error || `status ${lookup.status}`,
        });
    }
    const existing = lookup.ok ? lookup.member : null;
    const requireSmsStatus = Boolean(smsConsent) && smsApiSupport !== 'unsupported' && Boolean(toUsE164(phone));
    const nameGaps = blankNameFields(existing, firstName, lastName);
    const namesOk = Object.keys(nameGaps).length === 0;
    const tagsMissing = optInTagsMissing(existing, { emailMarketing, smsConsent });
    const profileReady =
        Boolean(existing) &&
        namesOk &&
        consentAlreadyApplied(existing, {
            emailMarketing,
            smsConsent,
            phoneMergeTag,
            phone,
            requireSmsStatus,
        });

    if (profileReady && !tagsMissing) {
        return resultBase({
            ok: true,
            already: true,
            phoneOnContact: Boolean(phoneMergeTag && phoneForMerge(phone)) || Boolean(existing?.sms_phone_number),
            emailMarketingSet: Boolean(emailMarketing),
            smsConsentSet: requireSmsStatus && smsStatusSaved(existing?.sms_subscription_status),
            tagsSet: true,
            phoneMergeTag,
            smsApiSupported: smsApiSupport === 'unknown' ? null : smsApiSupport === 'supported',
        });
    }

    const currentPhone = phoneMergeTag && existing?.merge_fields ? existing.merge_fields[phoneMergeTag] : null;
    let phoneOnContact = Boolean(String(currentPhone || '').trim()) || Boolean(existing?.sms_phone_number);
    let smsConsentSet = smsStatusSaved(existing?.sms_subscription_status);
    let reason = null;
    let wroteMember = false;
    let saved = existing;

    if (!profileReady) {
        let includeSms = Boolean(smsConsent) && smsApiSupport !== 'unsupported' && Boolean(toUsE164(phone));
        let includePhoneMerge = Boolean(phoneMergeTag && phoneForMerge(phone));
        let smsNumberStyle = 'e164';
        let last = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
            if (!emailMarketing && !includeSms && !includePhoneMerge) {
                return resultBase({
                    reason: smsApiSupport === 'unsupported' ? 'sms_unsupported_no_phone_field' : 'sms_not_stored',
                    phoneMergeTag,
                    smsApiSupported: smsApiSupport === 'supported',
                });
            }

            const body = buildConsentPayload({
                email: normalized,
                firstName,
                lastName,
                phone,
                emailMarketing,
                smsConsent,
                phoneMergeTag,
                includePhoneMerge,
                includeSmsFields: includeSms,
                smsNumberStyle,
                existing,
            });
            if (!body) {
                return resultBase({ reason: 'empty_payload', phoneMergeTag });
            }

            const method = !existing || emailMarketing ? 'PUT' : 'PATCH';
            try {
                last = await writeMember(cfg, normalized, body, method);
            } catch (err) {
                logger.warn('[mailchimp] upsert error:', err?.message || err);
                return resultBase({
                    reason: 'request_failed',
                    error: err?.message || String(err),
                    phoneMergeTag,
                });
            }

            if (last.ok) {
                saved = parseErrorBody(last.text) || saved;
                smsConsentSet = smsStatusSaved(saved?.sms_subscription_status);
                if (smsConsent && toUsE164(phone) && !smsConsentSet && smsApiSupport !== 'unsupported') {
                    try {
                        const smsResult = await applyAudienceSmsConsent(cfg, {
                            email: normalized,
                            phone,
                            emailMarketing,
                            preserveExistingEmail: String(existing?.status || '').toLowerCase() === 'subscribed',
                            historical: Boolean(historical),
                        });
                        if (smsResult.ok) {
                            smsConsentSet = true;
                            smsApiSupport = 'supported';
                        } else if (smsResult.programMissing) {
                            smsApiSupport = 'unsupported';
                            reason = 'sms_program_not_configured';
                        } else {
                            reason = smsResult.reason || 'sms_not_stored';
                        }
                    } catch (err) {
                        logger.warn('[mailchimp] sms consent error:', err?.message || err);
                        reason = 'sms_not_stored';
                    }
                } else if (smsConsentSet) {
                    smsApiSupport = 'supported';
                }
                phoneOnContact = Boolean(body.merge_fields && phoneMergeTag && body.merge_fields[phoneMergeTag])
                    || Boolean(saved?.sms_phone_number)
                    || phoneOnContact;
                if (smsConsent && !smsConsentSet && !reason) reason = 'phone_stored_without_sms_consent';
                wroteMember = true;
                break;
            }

            if (permanentlyDeletedError(last.text)) {
                return resultBase({
                    reason: 'permanently_deleted',
                    status: last.status,
                    errorTitle: errorTitle(last.text),
                    error: sanitizeMailchimpDetail(last.text),
                    phoneMergeTag,
                });
            }
            if (includeSms && smsErrorIsUnsupported(last.status, last.text)) {
                smsApiSupport = 'unsupported';
                includeSms = false;
                continue;
            }
            if (includeSms && smsNumberStyle === 'e164' && smsPhoneFormatError(last.text)) {
                smsNumberStyle = 'digits';
                continue;
            }
            if (!emailMarketing && transactionalStatusRejected(last.text)) {
                return resultBase({
                    reason: 'transactional_status_rejected',
                    phoneMergeTag,
                    error: sanitizeMailchimpDetail(last.text),
                    smsApiSupported: smsApiSupport === 'supported',
                });
            }
            if (includePhoneMerge && mergeFieldRejected(last.text, phoneMergeTag)) {
                includePhoneMerge = false;
                continue;
            }
            break;
        }

        if (!wroteMember) {
            return resultBase({
                reason: 'upsert_failed',
                status: last?.status || 0,
                errorTitle: errorTitle(last?.text || ''),
                error: sanitizeMailchimpDetail(last?.text || ''),
                phoneMergeTag,
                smsApiSupported: smsApiSupport === 'unknown' ? null : smsApiSupport === 'supported',
            });
        }
    }

    const tagResult = await applyOptInTags(cfg, normalized, { emailMarketing, smsConsent });
    const created = wroteMember && !existing;
    const updated = Boolean(existing) && (wroteMember || tagsMissing || !namesOk);
    if (!tagResult.ok) {
        return resultBase({
            ok: false,
            added: created,
            updated,
            phoneOnContact,
            emailMarketingSet: Boolean(
                emailMarketing && String(saved?.status || '').toLowerCase() === 'subscribed'
            ),
            smsConsentSet,
            tagsSet: false,
            phoneMergeTag,
            reason: 'opt_in_tag_failed',
            error: tagResult.error || null,
            smsApiSupported: smsConsentSet ? true : smsApiSupport === 'unsupported' ? false : null,
        });
    }

    return resultBase({
        ok: true,
        added: created,
        updated,
        phoneOnContact,
        emailMarketingSet: Boolean(
            emailMarketing && String(saved?.status || '').toLowerCase() === 'subscribed'
        ),
        smsConsentSet,
        tagsSet: true,
        phoneMergeTag,
        smsApiSupported: smsConsentSet ? true : smsApiSupport === 'unsupported' ? false : null,
        reason: smsConsent && !smsConsentSet ? reason : null,
    });
}

async function describeMailchimpAudience() {
    const cfg = mailchimpConfig();
    if (!cfg) {
        return { configured: false, listName: null, phoneMergeTag: null, smsApiSupported: null };
    }
    const meta = await loadAudienceMeta(cfg);
    return {
        configured: true,
        listName: meta.listName || null,
        phoneMergeTag: meta.phoneMergeTag || null,
        smsApiSupported: smsApiSupport === 'unknown' ? null : smsApiSupport === 'supported',
    };
}

function resetAudienceCacheForTests() {
    cachedPhoneMergeTag = undefined;
    cachedListName = null;
    smsApiSupport = 'unknown';
}

module.exports = {
    mailchimpConfig,
    upsertAudienceMember,
    pickPhoneMergeTag,
    buildConsentPayload,
    toUsE164,
    phoneForMerge,
    smsErrorIsUnsupported,
    smsProgramNotConfigured,
    consentAlreadyApplied,
    phonesMatch,
    desiredOptInTags,
    optInTagsMissing,
    blankNameFields,
    permanentlyDeletedError,
    EMAIL_OPT_IN_TAG,
    TEXT_OPT_IN_TAG,
    describeMailchimpAudience,
    resetAudienceCacheForTests,
};
