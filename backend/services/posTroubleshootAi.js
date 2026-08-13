'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { isNetworkSetupAiEnabled, getNetworkSetupAiConfig } = require('./networkSetupAi');

const ALLOWED_ACTIONS = Object.freeze([
    'go_general',
    'go_registers',
    'go_payments',
    'go_equipment',
    'go_license',
    'go_support',
    'add_equipment',
    'edit_equipment',
    'edit_next_mac',
    'scroll_equipment',
    'save_settings',
    'focus_settings',
    'focus_paste',
    'parse_list',
    'apply_all',
    'refresh_scan'
]);

const SYSTEM_PROMPT = `You are an AI troubleshoot assistant for a store's Business One POS admin panel.

Goals:
- Read the live diagnostic report and explain what is wrong in plain, friendly English.
- Give clear numbered steps the store owner can follow to fix each issue.
- Never guess device names, IPs, or register labels — only use what is in the context JSON.
- Prioritize urgent (error) issues before warnings.
- For network problems, refer only to addresses and settings already saved by the store.

You can suggest buttons using ONLY these action ids:
go_general, go_registers, go_payments, go_equipment, go_license, go_support,
add_equipment, edit_equipment, edit_next_mac, scroll_equipment,
save_settings, focus_settings, focus_paste, parse_list, apply_all, refresh_scan

When edit_equipment or edit_next_mac is needed, include equipmentId from context.
When guiding to a tab, prefer go_equipment, go_registers, etc.

If the user asks you to fix something, set autoAction to one allowed id when appropriate.

Never ask for passwords in chat.

Respond with JSON only (no markdown fences):
{
  "reply": "your message in plain English with clear steps",
  "suggestedActions": [{"id": "action_id", "label": "short button label", "equipmentId": null}],
  "autoAction": null,
  "autoActionEquipmentId": null,
  "highlight": null
}

highlight may be: network_form, equipment, paste, troubleshoot
Keep reply under 180 words unless the user asked for detail.`;

function compactTroubleshootContext(report) {
    const status = report?.statusReport || {};
    return {
        headline: status.headline,
        allClear: status.allClear,
        nextStep: status.nextStep,
        issues: (status.issues || []).slice(0, 20).map((i) => ({
            id: i.id,
            severity: i.severity,
            category: i.category,
            label: i.label,
            detail: i.detail,
            actionId: i.actionId,
            equipmentId: i.equipmentId,
            tab: i.tab
        })),
        okItems: (status.okItems || []).slice(0, 12),
        primaryMissing: status.primaryMissing,
        counts: report?.counts,
        categories: report?.categories,
        license: report?.license,
        registers: report?.registers,
        networkSummary: report?.network
            ? {
                  allDone: report.network.allDone,
                  missingCount: (report.network.missingItems || []).length,
                  gateway: report.network.networkSettings?.gateway
              }
            : null
    };
}

function parseAiJson(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

function sanitizeAiResponse(parsed) {
    if (!parsed || typeof parsed !== 'object') {
        return {
            reply: 'I had trouble formatting my answer. Please try again.',
            suggestedActions: [],
            autoAction: null,
            autoActionEquipmentId: null,
            highlight: null
        };
    }

    const suggestedActions = Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions
              .filter((a) => a && ALLOWED_ACTIONS.includes(a.id))
              .map((a) => ({
                  id: a.id,
                  label: String(a.label || a.id).slice(0, 80),
                  equipmentId: a.equipmentId != null ? Number(a.equipmentId) : null,
                  primary: Boolean(a.primary)
              }))
        : [];

    const autoAction = ALLOWED_ACTIONS.includes(parsed.autoAction) ? parsed.autoAction : null;
    const autoActionEquipmentId =
        parsed.autoActionEquipmentId != null ? Number(parsed.autoActionEquipmentId) : null;

    const highlightAllowed = new Set(['network_form', 'equipment', 'paste', 'troubleshoot']);
    const highlight = highlightAllowed.has(parsed.highlight) ? parsed.highlight : null;

    return {
        reply: String(parsed.reply || '').trim() || 'How can I help troubleshoot your POS setup?',
        suggestedActions,
        autoAction,
        autoActionEquipmentId,
        highlight
    };
}

async function callTroubleshootAi({ messages, context, systemPrompt = SYSTEM_PROMPT, sanitize = sanitizeAiResponse }) {
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
        const err = new Error('AI troubleshoot assistant is not configured. Add OPENAI_API_KEY to the server environment.');
        err.code = 'AI_NOT_CONFIGURED';
        throw err;
    }

    const baseUrl = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const payload = {
        model,
        temperature: 0.35,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'system', content: `Live diagnostics:\n${JSON.stringify(context, null, 2)}` },
            ...messages
        ],
        response_format: { type: 'json_object' }
    };

    try {
        const { data } = await axios.post(`${baseUrl}/chat/completions`, payload, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });

        const content = data?.choices?.[0]?.message?.content;
        const parsed = parseAiJson(content);
        return {
            ...sanitize(parsed),
            model,
            source: 'openai'
        };
    } catch (err) {
        const status = err.response?.status;
        const apiMsg = err.response?.data?.error?.message;
        logger.error('POS troubleshoot AI error:', { status, apiMsg, message: err.message });
        const wrapped = new Error(apiMsg || err.message || 'AI request failed');
        wrapped.code = status === 401 ? 'AI_AUTH_FAILED' : 'AI_REQUEST_FAILED';
        throw wrapped;
    }
}

function buildRulesBriefing(report) {
    const status = report?.statusReport || {};
    if (status.allClear) {
        return {
            reply: 'Everything we can see looks good. Registers, equipment, network, and license show no problems right now.',
            suggestedActions: [{ id: 'refresh_scan', label: 'Scan again', primary: true }],
            source: 'rules'
        };
    }

    const urgent = (status.issues || []).filter((i) => i.severity === 'error');
    const warnings = (status.issues || []).filter((i) => i.severity !== 'error');
    const lines = [];

    if (urgent.length) {
        lines.push('Fix these first:');
        urgent.slice(0, 5).forEach((i, idx) => {
            lines.push(`${idx + 1}. ${i.label}${i.detail ? ` — ${i.detail}` : ''}`);
        });
    }
    if (warnings.length) {
        lines.push(urgent.length ? '\nThen review:' : 'Review these:');
        warnings.slice(0, 5).forEach((i, idx) => {
            lines.push(`${idx + 1}. ${i.label}${i.detail ? ` — ${i.detail}` : ''}`);
        });
    }

    const primary = status.primaryMissing;
    const actions = primary
        ? [
              {
                  id: primary.actionId || `go_${primary.tab || 'equipment'}`,
                  label: primary.actionId === 'edit_equipment' ? 'Fix this' : 'Go fix',
                  equipmentId: primary.equipmentId || null,
                  primary: true
              }
          ]
        : [];

    return {
        reply: `${status.headline}\n\n${lines.join('\n')}`,
        suggestedActions: actions,
        source: 'rules'
    };
}

async function briefTroubleshootStore(report) {
    const context = compactTroubleshootContext(report);
    const userPrompt = `Give a proactive troubleshoot briefing. The user did NOT ask a question — you are scanning their store automatically.

Use the issues list from context. Your reply MUST include:
1. A plain-English summary of the biggest problem (or congratulate if allClear)
2. Numbered steps to fix the top 1-3 issues (specific device/register names from context)
3. What they can ignore for now if there are only minor warnings

Offer 1-2 suggestedActions for the most urgent fix. Include equipmentId when editing a device.`;

    return callTroubleshootAi({
        messages: [{ role: 'user', content: userPrompt }],
        context
    });
}

async function chatTroubleshoot({ report, messages, userMessage }) {
    const context = compactTroubleshootContext(report);
    const history = Array.isArray(messages) ? messages.slice(-12) : [];
    const sanitizedHistory = history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .map((m) => ({
            role: m.role,
            content: String(m.content).slice(0, 4000)
        }));

    return callTroubleshootAi({
        messages: [...sanitizedHistory, { role: 'user', content: String(userMessage || '').slice(0, 2000) }],
        context
    });
}

const REGISTER_SAFE_AUTO_ACTIONS = new Set([
    'syncOutbox',
    'refreshCatalog',
    'reinitHardware',
    'reinitPayment',
    'refreshShift',
    'clearPaymentOverride',
    'normalizeConfig',
    'reloadStore'
]);

const REGISTER_ALLOWED_ACTIONS = Object.freeze([
    'syncOutbox',
    'refreshCatalog',
    'reinitHardware',
    'testPrint',
    'reloadStore',
    'openSetup',
    'reinitPayment',
    'clearExpiredSession',
    'refreshShift',
    'runChecks',
    'fixWhatWeCan',
    'openBilling',
    'reloadApp',
    'normalizeConfig',
    'clearPaymentOverride',
    'scanAgain'
]);

const REGISTER_SYSTEM_PROMPT = `You are an AI help assistant on a Business One POS register. The merchant opened Help to scan ANY situation — sale in progress, printer issue, sync problem, etc.

Goals:
- Use situation (current screen, cart, recent error messages, shift) PLUS localChecks (device tests) PLUS server hardware/license issues.
- Explain in plain English for a cashier or store owner.
- Give numbered steps they can do ON THIS REGISTER. If admin/Equipment is needed, say "ask your manager."
- When you can fix something from the register, set autoAction to the matching action id (often fixWhatWeCan for multiple small fixes).
- Prioritize what blocks selling right now (offline, auth, sync, printer, payments).

Register action ids ONLY:
syncOutbox, refreshCatalog, reinitHardware, testPrint, reloadStore, openSetup, reinitPayment,
clearExpiredSession, refreshShift, runChecks, scanAgain, fixWhatWeCan, openBilling, reloadApp, normalizeConfig, clearPaymentOverride

Never ask for passwords.

Respond with JSON only (no markdown fences):
{
  "reply": "plain English with clear steps",
  "suggestedActions": [{"id": "action_id", "label": "short button label"}],
  "autoAction": null
}

Keep reply under 200 words unless the user asked for detail.`;

function compactRegisterContext(report) {
    const status = report?.statusReport || {};
    return {
        register: report?.register,
        situation: report?.situation || null,
        localSummary: report?.localSummary,
        localChecks: (report?.localChecks || []).filter((c) => c.id !== 'summary').slice(0, 20),
        serverIssues: (status.issues || [])
            .filter((i) => i.source === 'server' || i.managerRequired)
            .slice(0, 12)
            .map((i) => ({
                id: i.id,
                severity: i.severity,
                label: i.label,
                detail: i.detail,
                managerRequired: Boolean(i.managerRequired)
            })),
        registerIssues: (status.issues || [])
            .filter((i) => i.source === 'local')
            .slice(0, 12),
        hardwareProfile: report?.hardwareProfile,
        license: report?.license,
        headline: status.headline,
        allClear: status.allClear
    };
}

function sanitizeRegisterAiResponse(parsed) {
    if (!parsed || typeof parsed !== 'object') {
        return {
            reply: 'I had trouble formatting my answer. Please try again.',
            suggestedActions: [],
            autoAction: null
        };
    }

    const suggestedActions = Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions
              .filter((a) => a && REGISTER_ALLOWED_ACTIONS.includes(a.id))
              .map((a) => ({
                  id: a.id,
                  label: String(a.label || a.id).slice(0, 80),
                  primary: Boolean(a.primary)
              }))
        : [];

    const autoAction = REGISTER_SAFE_AUTO_ACTIONS.has(parsed.autoAction) ? parsed.autoAction : null;

    return {
        reply: String(parsed.reply || '').trim() || 'How can I help with this register?',
        suggestedActions,
        autoAction
    };
}

function buildRegisterRulesBriefing(report) {
    const status = report?.statusReport || {};
    const localSummary = report?.localSummary;
    if (status.allClear && localSummary?.status === 'ok') {
        return {
            reply: 'This register looks healthy. You can keep selling. Ask me if something still feels wrong.',
            suggestedActions: [{ id: 'runChecks', label: 'Run checks again', primary: true }],
            source: 'rules'
        };
    }

    const issues = (status.issues || []).slice(0, 6);
    const lines = issues.map((i, idx) => `${idx + 1}. ${i.label}${i.detail ? ` — ${i.detail}` : ''}`);
    const primary = status.primaryMissing;
    const primaryAction = primary?.actionId && REGISTER_ALLOWED_ACTIONS.includes(primary.actionId) ? primary.actionId : 'fixWhatWeCan';

    return {
        reply: `${localSummary?.title || status.headline}\n\n${lines.length ? `${lines.join('\n')}\n\n` : ''}Try the button below or ask me a question.`,
        suggestedActions: [{ id: primaryAction, label: 'Try to fix', primary: true }],
        source: 'rules'
    };
}

async function briefRegisterTroubleshoot(report) {
    const context = compactRegisterContext(report);
    const userPrompt = `Proactive Help scan — merchant opened Help to see what is wrong and what can be fixed on this register.

Use situation (what they are doing right now, cart, recent messages) and localChecks. Your reply MUST:
1. Say what you found — tie to their situation if relevant (e.g. sale in cart, recent error toast)
2. Numbered steps to fix on this register first
3. Say if manager/admin must change Equipment or billing

If fixWhatWeCan would help, include it in suggestedActions or set autoAction to fixWhatWeCan.`;

    return callTroubleshootAi({
        messages: [{ role: 'user', content: userPrompt }],
        context,
        systemPrompt: REGISTER_SYSTEM_PROMPT,
        sanitize: sanitizeRegisterAiResponse
    });
}

async function chatRegisterTroubleshoot({ report, messages, userMessage }) {
    const context = compactRegisterContext(report);
    const history = Array.isArray(messages) ? messages.slice(-12) : [];
    const sanitizedHistory = history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .map((m) => ({
            role: m.role,
            content: String(m.content).slice(0, 4000)
        }));

    return callTroubleshootAi({
        messages: [...sanitizedHistory, { role: 'user', content: String(userMessage || '').slice(0, 2000) }],
        context,
        systemPrompt: REGISTER_SYSTEM_PROMPT,
        sanitize: sanitizeRegisterAiResponse
    });
}

module.exports = {
    ALLOWED_ACTIONS,
    REGISTER_ALLOWED_ACTIONS,
    isTroubleshootAiEnabled: isNetworkSetupAiEnabled,
    getTroubleshootAiConfig: getNetworkSetupAiConfig,
    buildRulesBriefing,
    buildRegisterRulesBriefing,
    briefTroubleshootStore,
    briefRegisterTroubleshoot,
    chatTroubleshoot,
    chatRegisterTroubleshoot
};
