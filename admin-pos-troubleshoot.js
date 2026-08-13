/**
 * Admin POS — AI troubleshoot assistant (store-wide diagnostics)
 */
(function () {
    'use strict';

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    async function posApi(path, opts) {
        return window.adminApp.apiRequest('/admin/pos' + path, opts);
    }

    function loadNetworkClientState() {
        try {
            const raw = localStorage.getItem('hmherbs_pos_network_setup_v1');
            const parsed = raw ? JSON.parse(raw) : {};
            return {
                skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
                routerMarkedDone: Boolean(parsed.routerMarkedDone),
                backupTestDone: Boolean(parsed.backupTestDone)
            };
        } catch {
            return { skipped: [], routerMarkedDone: false, backupTestDone: false };
        }
    }

    let troubleshootBound = false;
    let troubleshootSnapshot = null;
    let troubleshootAiEnabled = false;
    let troubleshootAiModel = '';
    let troubleshootMessages = [];
    let troubleshootLastFingerprint = '';
    let troubleshootLoading = false;

    const CHAT_STORAGE_KEY = 'hmherbs_pos_troubleshoot_chat_v1';

    function loadChatHistory() {
        try {
            const raw = localStorage.getItem(CHAT_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.slice(-40) : [];
        } catch {
            return [];
        }
    }

    function saveChatHistory() {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(troubleshootMessages.slice(-40)));
    }

    function appendMessage(role, content, extras = {}) {
        if (extras.kind === 'briefing') {
            troubleshootMessages = troubleshootMessages.filter((m) => m.kind !== 'briefing');
        }
        troubleshootMessages.push({
            role,
            content: String(content || ''),
            suggestedActions: extras.suggestedActions || [],
            kind: extras.kind || null,
            ts: Date.now()
        });
        saveChatHistory();
        renderChatLog();
    }

    function renderStatusPanel(report) {
        const panel = document.getElementById('pos-troubleshoot-status');
        const headline = document.getElementById('pos-troubleshoot-status-headline');
        const next = document.getElementById('pos-troubleshoot-status-next');
        const issuesMount = document.getElementById('pos-troubleshoot-status-issues');
        const okMount = document.getElementById('pos-troubleshoot-status-ok');
        const badge = document.getElementById('pos-troubleshoot-issue-count');
        if (!panel || !report) return;
        panel.style.display = '';

        const issues = report.issues || [];
        const okItems = report.okItems || [];

        if (badge) {
            if (report.allClear) {
                badge.textContent = 'All clear';
                badge.className = 'pos-troubleshoot-badge is-clear';
            } else {
                const errors = issues.filter((i) => i.severity === 'error').length;
                badge.textContent = errors ? `${errors} urgent` : `${issues.length} to review`;
                badge.className = 'pos-troubleshoot-badge' + (errors ? ' is-error' : ' is-warning');
            }
        }

        if (headline) headline.textContent = report.headline || 'Checking your store…';
        if (next) {
            if (report.allClear) {
                next.textContent = 'No problems detected. Ask a question below if something still feels wrong on a register.';
            } else if (report.nextStep) {
                next.innerHTML = `<strong>Start here:</strong> ${esc(report.nextStep.title)}${report.nextStep.summary ? ` — ${esc(report.nextStep.summary)}` : ''}`;
            } else {
                next.textContent = 'Review the items below or ask the assistant for step-by-step help.';
            }
        }

        if (issuesMount) {
            issuesMount.innerHTML = issues.length
                ? issues
                      .map((item) => {
                          const sev = item.severity === 'error' ? 'is-error' : 'is-warning';
                          const fixBtn = item.actionId
                              ? ` <button type="button" class="btn btn-ghost btn-sm" data-ts-fix="${esc(item.actionId)}"${item.equipmentId ? ` data-equipment-id="${item.equipmentId}"` : ''}${item.tab ? ` data-ts-tab="${esc(item.tab)}"` : ''}>Fix</button>`
                              : '';
                          return `<li class="${sev}">${esc(item.label)}${item.detail ? ` <span style="color:var(--gray-600);">(${esc(item.detail)})</span>` : ''}${fixBtn}</li>`;
                      })
                      .join('')
                : '<li class="is-empty" style="list-style:none;padding:0;">No issues found.</li>';
            issuesMount.querySelectorAll('[data-ts-fix]').forEach((btn) => {
                btn.addEventListener('click', () =>
                    runTroubleshootAction(btn.getAttribute('data-ts-fix'), {
                        equipmentId: btn.getAttribute('data-equipment-id'),
                        tab: btn.getAttribute('data-ts-tab')
                    })
                );
            });
        }

        if (okMount) {
            okMount.innerHTML = okItems.length
                ? okItems.slice(0, 8).map((d) => `<li>${esc(d)}</li>`).join('')
                : '<li class="is-empty" style="list-style:none;padding:0;">—</li>';
        }
    }

    function renderChatLog() {
        const log = document.getElementById('pos-troubleshoot-chat-log');
        if (!log) return;
        if (!troubleshootMessages.length) {
            log.innerHTML =
                '<div class="pos-network-assistant-chat-bubble is-assistant">Scanning your store setup…</div>';
            return;
        }
        log.innerHTML = troubleshootMessages
            .map((msg, idx) => {
                const cls =
                    msg.role === 'user'
                        ? 'is-user'
                        : msg.kind === 'briefing'
                          ? 'is-assistant is-briefing'
                          : 'is-assistant';
                const actions =
                    msg.role === 'assistant' && msg.suggestedActions?.length
                        ? `<div class="pos-network-assistant-chat-actions">${msg.suggestedActions
                              .map((a) => {
                                  const btnCls = a.primary ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
                                  const attrs = [`data-ts-action="${esc(a.id)}"`, `class="${btnCls}"`, `data-msg-idx="${idx}"`];
                                  if (a.equipmentId) attrs.push(`data-equipment-id="${a.equipmentId}"`);
                                  return `<button type="button" ${attrs.join(' ')}>${esc(a.label)}</button>`;
                              })
                              .join('')}</div>`
                        : '';
                return `<div class="pos-network-assistant-chat-bubble ${cls}">${esc(msg.content)}${actions}</div>`;
            })
            .join('');
        log.querySelectorAll('[data-ts-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                runTroubleshootAction(btn.getAttribute('data-ts-action'), {
                    equipmentId: btn.getAttribute('data-equipment-id')
                });
            });
        });
        log.scrollTop = log.scrollHeight;
    }

    function updateAiBanner() {
        const banner = document.getElementById('pos-troubleshoot-ai-banner');
        const tag = document.getElementById('pos-troubleshoot-model-tag');
        if (tag) {
            tag.textContent = troubleshootAiEnabled
                ? `(AI · ${troubleshootAiModel || 'connected'})`
                : '(rules-based — add API key for chat)';
        }
        if (!banner) return;
        if (troubleshootAiEnabled) {
            banner.style.display = 'none';
            return;
        }
        banner.style.display = '';
        banner.innerHTML =
            '<strong>AI chat is not connected.</strong> The scan and Fix buttons still work. Add <code>OPENAI_API_KEY</code> to <code>backend/.env</code> and restart the server for conversational help.';
    }

    async function runTroubleshootAction(actionId, meta = {}) {
        const hub = window.AdminPosHub;
        if (!hub) return;

        const goTab = actionId.startsWith('go_') ? actionId.replace('go_', '') : meta.tab || null;
        if (goTab && hub.switchPosTab) {
            hub.switchPosTab(goTab);
        }

        switch (actionId) {
            case 'go_general':
            case 'go_registers':
            case 'go_payments':
            case 'go_equipment':
            case 'go_license':
            case 'go_support':
                break;
            case 'edit_equipment':
                if (hub.openEquipmentEditor && meta.equipmentId) {
                    await hub.openEquipmentEditor(Number(meta.equipmentId));
                } else if (hub.switchPosTab) {
                    hub.switchPosTab('equipment');
                }
                break;
            case 'refresh_scan':
                await refreshTroubleshoot({ forceBriefing: true });
                window.adminApp?.showToast?.('Scan complete', 'success');
                break;
            default:
                if (hub.runSetupAction) {
                    await hub.runSetupAction(actionId, meta);
                }
                break;
        }
    }

    async function handleAiResponse(result) {
        if (!result) return;
        appendMessage('assistant', result.reply || '', {
            suggestedActions: result.suggestedActions || []
        });
        if (result.autoAction) {
            await runTroubleshootAction(result.autoAction, {
                equipmentId: result.autoActionEquipmentId
            });
        }
    }

    async function fetchBriefing(force = false) {
        const report = troubleshootSnapshot?.statusReport;
        if (!report) return;
        const fp = report.fingerprint || '';
        if (!force && fp && fp === troubleshootLastFingerprint) return;

        troubleshootLastFingerprint = fp;
        troubleshootLoading = true;

        const thinkingId = `ts-thinking-${Date.now()}`;
        const logEl = document.getElementById('pos-troubleshoot-chat-log');
        if (logEl) {
            logEl.insertAdjacentHTML(
                'beforeend',
                `<div class="pos-network-assistant-chat-bubble is-thinking" id="${thinkingId}">Reviewing what might be wrong…</div>`
            );
            logEl.scrollTop = logEl.scrollHeight;
        }

        try {
            const res = await posApi('/troubleshoot-assistant/briefing', {
                method: 'POST',
                body: JSON.stringify({ clientState: loadNetworkClientState() })
            });
            document.getElementById(thinkingId)?.remove();
            appendMessage('assistant', res.reply || '', {
                kind: 'briefing',
                suggestedActions: res.suggestedActions || []
            });
            if (res.autoAction) {
                await runTroubleshootAction(res.autoAction, {
                    equipmentId: res.autoActionEquipmentId
                });
            }
        } catch (err) {
            document.getElementById(thinkingId)?.remove();
            const fallback = troubleshootSnapshot?.statusReport;
            if (fallback) {
                const lines = (fallback.issues || [])
                    .slice(0, 6)
                    .map((i) => `• ${i.label}`)
                    .join('\n');
                appendMessage(
                    'assistant',
                    `${fallback.headline}\n\n${lines ? `Issues found:\n${lines}\n\n` : ''}Use the Fix buttons or ask me a question below.`,
                    {
                        kind: 'briefing',
                        suggestedActions: fallback.primaryMissing
                            ? [
                                  {
                                      id: fallback.primaryMissing.actionId,
                                      label: 'Fix top issue',
                                      equipmentId: fallback.primaryMissing.equipmentId,
                                      primary: true
                                  }
                              ]
                            : []
                    }
                );
            } else {
                appendMessage('assistant', err.message || 'Could not load troubleshoot briefing.', {
                    kind: 'briefing'
                });
            }
        } finally {
            troubleshootLoading = false;
        }
    }

    async function sendChat(userMessage) {
        const text = String(userMessage || '').trim();
        if (!text) return;

        appendMessage('user', text);
        const input = document.getElementById('pos-troubleshoot-chat-input');
        const sendBtn = document.getElementById('pos-troubleshoot-chat-send');
        if (input) input.value = '';
        if (sendBtn) sendBtn.disabled = true;

        const history = troubleshootMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .slice(0, -1)
            .map((m) => ({ role: m.role, content: m.content }));

        const thinkingId = `ts-thinking-${Date.now()}`;
        const logEl = document.getElementById('pos-troubleshoot-chat-log');
        if (logEl) {
            logEl.insertAdjacentHTML(
                'beforeend',
                `<div class="pos-network-assistant-chat-bubble is-thinking" id="${thinkingId}">Thinking…</div>`
            );
            logEl.scrollTop = logEl.scrollHeight;
        }

        try {
            const res = await posApi('/troubleshoot-assistant/chat', {
                method: 'POST',
                body: JSON.stringify({
                    message: text,
                    messages: history,
                    clientState: loadNetworkClientState()
                })
            });
            document.getElementById(thinkingId)?.remove();
            await handleAiResponse(res);
            await refreshTroubleshoot({ skipBriefing: true });
        } catch (err) {
            document.getElementById(thinkingId)?.remove();
            appendMessage('assistant', err.message || 'Something went wrong. Please try again.');
        } finally {
            if (sendBtn) sendBtn.disabled = false;
            if (input) input.focus();
        }
    }

    async function refreshTroubleshoot(opts = {}) {
        const mount = document.getElementById('pos-troubleshoot-assistant');
        if (!mount) return;

        const clientState = loadNetworkClientState();
        const qs = new URLSearchParams();
        if (clientState.skipped.length) qs.set('skipped', clientState.skipped.join(','));
        if (clientState.routerMarkedDone) qs.set('routerMarkedDone', '1');
        if (clientState.backupTestDone) qs.set('backupTestDone', '1');

        try {
            const res = await posApi('/troubleshoot-assistant?' + qs.toString());
            troubleshootSnapshot = res.report || null;
            troubleshootAiEnabled = Boolean(res.ai?.enabled);
            troubleshootAiModel = res.ai?.model || '';
            updateAiBanner();
            if (troubleshootSnapshot?.statusReport) {
                renderStatusPanel(troubleshootSnapshot.statusReport);
            }
            const progress = document.getElementById('pos-troubleshoot-progress');
            if (progress) {
                const c = troubleshootSnapshot?.counts || {};
                progress.textContent = troubleshootSnapshot?.statusReport?.allClear
                    ? 'No issues detected'
                    : `${c.errors || 0} urgent · ${c.warnings || 0} warning(s) · ${c.registers || 0} register(s)`;
            }
            if (!opts.skipBriefing) {
                await fetchBriefing(Boolean(opts.forceBriefing));
            }
        } catch (err) {
            const progress = document.getElementById('pos-troubleshoot-progress');
            if (progress) progress.textContent = err.message || 'Could not scan store';
        }
    }

    function bindTroubleshoot() {
        if (troubleshootBound) return;
        troubleshootBound = true;
        troubleshootMessages = loadChatHistory();
        renderChatLog();

        document.getElementById('pos-troubleshoot-refresh')?.addEventListener('click', () => {
            troubleshootLastFingerprint = '';
            refreshTroubleshoot({ forceBriefing: true });
        });

        document.getElementById('pos-troubleshoot-clear-chat')?.addEventListener('click', () => {
            troubleshootMessages = [];
            troubleshootLastFingerprint = '';
            saveChatHistory();
            renderChatLog();
            refreshTroubleshoot({ forceBriefing: true });
        });

        document.getElementById('pos-troubleshoot-chat-form')?.addEventListener('submit', (ev) => {
            ev.preventDefault();
            const input = document.getElementById('pos-troubleshoot-chat-input');
            sendChat(input?.value || '');
        });

        const toggle = document.getElementById('pos-troubleshoot-toggle');
        const body = document.getElementById('pos-troubleshoot-body');
        if (toggle && body) {
            toggle.addEventListener('click', () => {
                const collapsed = body.classList.toggle('is-collapsed');
                toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                toggle.textContent = collapsed ? 'Show assistant' : 'Hide';
            });
        }
    }

    window.AdminPosTroubleshoot = {
        init() {
            bindTroubleshoot();
            return refreshTroubleshoot();
        },
        refresh(opts) {
            return refreshTroubleshoot(opts || {});
        }
    };
})();
