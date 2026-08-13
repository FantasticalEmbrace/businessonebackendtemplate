'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const ALLOWED_ACTIONS = Object.freeze([
    'save_settings',
    'focus_settings',
    'add_equipment',
    'scroll_equipment',
    'edit_next_mac',
    'router_done',
    'focus_paste',
    'parse_list',
    'apply_all',
    'backup_done'
]);

const SYSTEM_PROMPT = `You are an AI setup assistant helping a store owner configure their POS network in an admin panel.

Goals:
- Walk them through fixed network addresses for registers, printers, and card readers.
- Use plain, friendly English. Explain technical terms briefly when needed.
- Use the live store context JSON — never guess equipment names or IPs that are not in context.
- Use only addresses and settings the store owner has entered — do not recommend a fixed IP scheme.

You can suggest buttons using ONLY these action ids:
save_settings, focus_settings, add_equipment, scroll_equipment, edit_next_mac, router_done, focus_paste, parse_list, apply_all, backup_done

When edit_next_mac is needed, include equipmentId from context for the specific device.

If the user asks you to do something (e.g. "load addresses", "save settings", "parse my list"), set autoAction to one allowed id so the app can run it.

Never ask for Wi-Fi passwords or router passwords in chat. Tell them to use the Network notes field.

Respond with JSON only (no markdown fences):
{
  "reply": "your message in plain English",
  "suggestedActions": [{"id": "action_id", "label": "short button label", "equipmentId": null}],
  "autoAction": null,
  "autoActionEquipmentId": null,
  "highlight": null
}

highlight may be: network_form, equipment, paste — to scroll the user to the right area.
Keep reply under 120 words unless the user asked for detail.`;

function isNetworkSetupAiEnabled() {
    return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

function getNetworkSetupAiConfig() {
    return {
        enabled: isNetworkSetupAiEnabled(),
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        provider: 'openai'
    };
}

function compactContext(snapshot, stepId = null) {
    const step = (snapshot?.steps || []).find((s) => s.id === (stepId || snapshot.currentStepId));
    return {
        currentStepId: snapshot?.currentStepId,
        viewingStepId: stepId || snapshot?.currentStepId,
        allDone: snapshot?.allDone,
        statusReport: snapshot?.statusReport,
        step: step
            ? {
                  id: step.id,
                  title: step.title,
                  status: step.status,
                  checks: step.checks,
                  availableActions: (step.actions || []).map((a) => a.id)
              }
            : null,
        settings: snapshot?.settings,
        counts: snapshot?.counts,
        missingMacEquipment: snapshot?.missingMacEquipment,
        missingAddressEquipment: snapshot?.missingAddressEquipment,
        networkEquipment: snapshot?.networkEquipment
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

    let autoAction = ALLOWED_ACTIONS.includes(parsed.autoAction) ? parsed.autoAction : null;
    const autoActionEquipmentId =
        parsed.autoActionEquipmentId != null ? Number(parsed.autoActionEquipmentId) : null;

    const highlightAllowed = new Set(['network_form', 'equipment', 'paste']);
    const highlight = highlightAllowed.has(parsed.highlight) ? parsed.highlight : null;

    return {
        reply: String(parsed.reply || '').trim() || 'How can I help with your network setup?',
        suggestedActions,
        autoAction,
        autoActionEquipmentId,
        highlight
    };
}

async function callNetworkSetupAi({ messages, context }) {
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
        const err = new Error('AI setup assistant is not configured. Add OPENAI_API_KEY to the server environment.');
        err.code = 'AI_NOT_CONFIGURED';
        throw err;
    }

    const baseUrl = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const payload = {
        model,
        temperature: 0.4,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'system',
                content: `Live store context:\n${JSON.stringify(context, null, 2)}`
            },
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
            ...sanitizeAiResponse(parsed),
            model,
            source: 'openai'
        };
    } catch (err) {
        const status = err.response?.status;
        const apiMsg = err.response?.data?.error?.message;
        logger.error('Network setup AI error:', { status, apiMsg, message: err.message });
        const wrapped = new Error(apiMsg || err.message || 'AI request failed');
        wrapped.code = status === 401 ? 'AI_AUTH_FAILED' : 'AI_REQUEST_FAILED';
        throw wrapped;
    }
}

async function briefNetworkSetup(snapshot) {
    const context = compactContext(snapshot);
    const report = snapshot?.statusReport || {};

    const userPrompt = `Give a proactive setup briefing. The user did NOT ask a question — you are checking their store automatically.

Use statusReport and live context. Your reply MUST include:
1. What is already finished (1 short sentence, only if something is done)
2. What is still missing — name each item from statusReport.missingItems (device names, not generic advice)
3. The single next step they should take right now (from statusReport.nextStep or primaryMissing)
4. One encouraging plain-English sentence

If statusReport.allDone is true, congratulate them briefly.

Offer 1-2 suggestedActions for the most important next action. Use equipmentId when editing a specific device.`;

    return callNetworkSetupAi({
        messages: [{ role: 'user', content: userPrompt }],
        context
    });
}

function buildRulesBriefing(snapshot) {
    const report = snapshot?.statusReport || {};
    if (report.allDone) {
        return {
            reply: 'Your network setup looks complete. Every device on file has an address, and the steps are done.',
            suggestedActions: [],
            source: 'rules'
        };
    }
    const missingLines = (report.missingItems || [])
        .slice(0, 6)
        .map((m) => `• ${m.label}${m.detail ? ` — ${m.detail}` : ''}`)
        .join('\n');
    const doneLine = report.completedItems?.length
        ? `Done so far: ${report.completedItems.join(', ')}.\n\n`
        : '';
    const nextLine = report.nextStep
        ? `Next step: ${report.nextStep.title}. ${report.nextStep.summary || ''}`
        : 'Pick the first incomplete step above.';
    const primary = report.primaryMissing;
    const actions = primary
        ? [
              {
                  id: primary.actionId,
                  label: primary.actionId === 'edit_next_mac' ? `Fix ${primary.label.replace('Hardware address (MAC) missing on ', '')}` : 'Do next step',
                  equipmentId: primary.equipmentId || null,
                  primary: true
              }
          ]
        : [];
    return {
        reply: `${report.headline}\n\n${doneLine}Still missing:\n${missingLines || '• Nothing flagged — review the steps above.'}\n\n${nextLine}`,
        suggestedActions: actions,
        source: 'rules'
    };
}

async function coachNetworkSetupStep(snapshot, stepId) {
    const context = compactContext(snapshot, stepId);
    const step = (snapshot.steps || []).find((s) => s.id === stepId);
    const userPrompt =
        step?.status === 'complete'
            ? `The user is viewing completed step "${step.title}". Briefly confirm what was done and what to do next.`
            : step?.status === 'skipped'
              ? `The user skipped step "${step.title}". Acknowledge that and say what they might still need to do manually.`
              : `Coach the user through step "${step?.title || stepId}". Tell them exactly what to do next in plain English. Offer 1-2 action buttons that match their situation.`;

    return callNetworkSetupAi({
        messages: [{ role: 'user', content: userPrompt }],
        context
    });
}

async function chatNetworkSetup({ snapshot, messages, userMessage }) {
    const context = compactContext(snapshot);
    const history = Array.isArray(messages) ? messages.slice(-12) : [];
    const sanitizedHistory = history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .map((m) => ({
            role: m.role,
            content: String(m.content).slice(0, 4000)
        }));

    return callNetworkSetupAi({
        messages: [...sanitizedHistory, { role: 'user', content: String(userMessage || '').slice(0, 2000) }],
        context
    });
}

module.exports = {
    ALLOWED_ACTIONS,
    isNetworkSetupAiEnabled,
    getNetworkSetupAiConfig,
    briefNetworkSetup,
    buildRulesBriefing,
    coachNetworkSetupStep,
    chatNetworkSetup,
    compactContext
};
