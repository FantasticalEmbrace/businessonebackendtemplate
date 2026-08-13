/**
 * Admin Point of Sale — equipment tabs, manual hardware CRUD
 */
(function () {
    'use strict';

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function fieldLabel(text, required) {
        return `${esc(text)}${required ? '<span class="form-required-mark" aria-hidden="true">*</span>' : ''}`;
    }

    function configFieldLabel(field, config) {
        return fieldLabel(field.label, fieldRequired(field, config));
    }

    async function posApi(path, opts) {
        return window.adminApp.apiRequest('/admin/pos' + path, opts);
    }

    let equipmentTypes = [];
    let equipmentRows = [];
    let registerOptions = [];
    let tabsBound = false;
    let dhcpMatchResults = null;
    let networkBound = false;
    let setupAssistantSnapshot = null;
    let setupAssistantViewStepId = null;
    let setupAssistantBound = false;
    let setupAiEnabled = false;
    let setupAiModel = '';
    let setupAiMessages = [];
    let setupAiCoachedSteps = new Set();
    let setupAiCoachLoading = false;
    let setupLastBriefingFingerprint = '';
    const SETUP_STORAGE_KEY = 'hmherbs_pos_network_setup_v1';
    const SETUP_CHAT_STORAGE_KEY = 'hmherbs_pos_network_setup_chat_v1';

    function typeMeta(id) {
        return equipmentTypes.find((t) => t.id === id) || null;
    }

    function fieldVisible(field, config) {
        if (!field.showWhen) return true;
        const val = String(config?.[field.showWhen.field] ?? '');
        if (field.showWhen.equals !== undefined) return val === String(field.showWhen.equals);
        if (Array.isArray(field.showWhen.in)) return field.showWhen.in.map(String).includes(val);
        return false;
    }

    function fieldRequired(field, config) {
        if (field?.required) return true;
        if (field?.requiredWhen) {
            const val = String(config?.[field.requiredWhen.field] ?? '');
            if (field.requiredWhen.equals !== undefined) return val === String(field.requiredWhen.equals);
            if (Array.isArray(field.requiredWhen.in)) return field.requiredWhen.in.map(String).includes(val);
        }
        return false;
    }

    function equipmentIdentityText() {
        const manufacturer = document.getElementById('pos-equipment-manufacturer')?.value || '';
        const model = document.getElementById('pos-equipment-model')?.value || '';
        return `${manufacturer} ${model}`.trim().toLowerCase();
    }

    function isPayPointRegister() {
        return equipmentIdentityText().includes('paypoint');
    }

    function isAndroidAioRegister() {
        return /sunmi|landi|aures/.test(equipmentIdentityText());
    }

    function updatePayPointFormHints(typeId) {
        const guide = document.getElementById('pos-equipment-paypoint-guide');
        const serialLabel = document.querySelector('label[for="pos-equipment-serial"]');
        const registerHelp = document.getElementById('pos-equipment-register-help');
        const needsStationIds = typeId === 'register' && (isPayPointRegister() || isAndroidAioRegister());
        const needsSerial = typeId === 'register' || typeId === 'card_terminal';

        if (guide) {
            if (isPayPointRegister()) {
                guide.style.display = '';
                const strong = guide.querySelector('strong');
                if (strong) strong.textContent = 'How this PayPoint ties to the real unit';
            } else if (isAndroidAioRegister()) {
                guide.style.display = '';
                const strong = guide.querySelector('strong');
                if (strong) strong.textContent = 'How this Android register ties to the real unit';
            } else {
                guide.style.display = 'none';
            }
        }

        if (serialLabel) {
            serialLabel.innerHTML = needsSerial
                ? `${fieldLabel('Serial number', true)} <span class="form-optional-hint" style="font-weight:normal;">(device label)</span>`
                : 'Serial number <span class="form-optional-hint">(optional)</span>';
        }

        const serialInput = document.getElementById('pos-equipment-serial');
        if (serialInput) serialInput.required = needsSerial;

        const registerSelect = document.getElementById('pos-equipment-register');
        if (registerSelect) registerSelect.required = Boolean(typeId && typeId !== 'other');

        if (registerHelp) {
            registerHelp.textContent = needsStationIds
                ? 'Required — must match the register whose API key is on this unit. All peripherals for this station use the same register.'
                : 'Required — assign all equipment for a station to the same register so they wire together at runtime.';
        }
    }

    function renderConfigFields(typeId, config) {
        const mount = document.getElementById('pos-equipment-config-fields');
        if (!mount) return;

        const cfg = { ...(config || {}) };
        const meta = typeMeta(typeId);
        const fields = meta?.configFields || [];
        const manualWrap = document.getElementById('pos-equipment-manual-wrap');

        if (manualWrap) manualWrap.style.display = 'grid';

        if (!fields.length) {
            mount.innerHTML = '';
            return;
        }

        const registerId = document.getElementById('pos-equipment-register')?.value;
        const editingId = document.getElementById('pos-equipment-id')?.value;

        mount.innerHTML = fields
            .filter((f) => fieldVisible(f, cfg))
            .map((f, fieldIndex) => {
                const val = cfg[f.key] ?? f.default ?? '';
                const help = f.help
                    ? `<p class="form-help" style="margin:0.35rem 0 0;">${esc(f.help)}</p>`
                    : '';
                const fieldId = `pos-equipment-cfg-${fieldIndex}-${String(f.key).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

                if (f.type === 'equipment_link') {
                    const filterType = f.filterType || 'receipt_printer';
                    const options = equipmentRows
                        .filter((e) => {
                            if (e.equipmentType !== filterType || !e.isActive) return false;
                            if (editingId && Number(editingId) === e.id) return false;
                            if (!registerId) return true;
                            return Number(e.posDeviceId) === Number(registerId) || !e.posDeviceId;
                        })
                        .map(
                            (e) =>
                                `<option value="${e.id}"${Number(val) === e.id ? ' selected' : ''}>${esc(e.label)}${e.posDeviceLabel ? ` (${esc(e.posDeviceLabel)})` : ''}</option>`
                        )
                        .join('');
                    return `<div class="form-group">
                        <label for="${fieldId}">${configFieldLabel(f, cfg)}</label>
                        <select id="${fieldId}" class="form-input pos-equipment-config-input" data-config-key="${esc(f.key)}"${fieldRequired(f, cfg) ? ' required' : ''}>
                            <option value="">— Select printer —</option>
                            ${options}
                        </select>
                        ${help}
                    </div>`;
                }

                if (f.type === 'select') {
                    const opts = (f.options || [])
                        .map((o) => {
                            const value = typeof o === 'string' ? o : o.value;
                            const label = typeof o === 'string' ? o.replace(/_/g, ' ') : o.label;
                            return `<option value="${esc(value)}"${String(val) === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
                        })
                        .join('');
                    return `<div class="form-group">
                        <label for="${fieldId}">${configFieldLabel(f, cfg)}</label>
                        <select id="${fieldId}" class="form-input pos-equipment-config-input" data-config-key="${esc(f.key)}"${fieldRequired(f, cfg) ? ' required' : ''}>${opts}</select>
                        ${help}
                    </div>`;
                }

                return `<div class="form-group">
                    <label for="${fieldId}">${configFieldLabel(f, cfg)}</label>
                    <input id="${fieldId}" class="form-input pos-equipment-config-input" data-config-key="${esc(f.key)}" type="text" value="${esc(val)}" maxlength="200"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${fieldRequired(f, cfg) ? ' required' : ''}>
                    ${help}
                </div>`;
            })
            .join('');

        mount.querySelectorAll('.pos-equipment-config-input').forEach((el) => {
            el.addEventListener('change', () => {
                const key = el.getAttribute('data-config-key');
                if (
                    key === 'connection' ||
                    key === 'mode' ||
                    key === 'kickMode' ||
                    key === 'adPlaylistMode'
                ) {
                    renderConfigFields(typeId, readConfigFromForm());
                }
            });
        });

        updatePayPointFormHints(typeId);
    }

    function readConfigFromForm() {
        const config = {};
        document.querySelectorAll('.pos-equipment-config-input').forEach((el) => {
            const key = el.getAttribute('data-config-key');
            if (key) config[key] = el.value;
        });
        return config;
    }

    function fillRegisterSelect(selectedId) {
        const sel = document.getElementById('pos-equipment-register');
        if (!sel) return;
        const base = '<option value="">— Any / unassigned —</option>';
        sel.innerHTML =
            base +
            registerOptions
                .filter((d) => d.isActive)
                .map(
                    (d) =>
                        `<option value="${d.id}"${Number(selectedId) === Number(d.id) ? ' selected' : ''}>${esc(d.deviceLabel)}</option>`
                )
                .join('');
    }

    function fillTypeSelect(selectedType) {
        const sel = document.getElementById('pos-equipment-type');
        const help = document.getElementById('pos-equipment-type-help');
        if (!sel) return;
        sel.innerHTML = equipmentTypes
            .map((t) => `<option value="${esc(t.id)}"${t.id === selectedType ? ' selected' : ''}>${esc(t.label)}</option>`)
            .join('');
        const meta = typeMeta(selectedType || sel.value);
        if (help) help.textContent = meta?.description || '';
    }

    function showEquipmentEditor(row, opts = {}) {
        const card = document.getElementById('pos-equipment-editor-card');
        const title = document.getElementById('pos-equipment-editor-title');
        if (!card) return;
        card.style.display = '';
        const isEdit = Boolean(row?.id);
        if (title) title.textContent = isEdit ? 'Edit equipment' : 'Add equipment';
        document.getElementById('pos-equipment-id').value = isEdit ? String(row.id) : '';
        fillTypeSelect(row?.equipmentType || 'register');
        document.getElementById('pos-equipment-label').value = row?.label || '';
        document.getElementById('pos-equipment-manufacturer').value = row?.manufacturer || '';
        document.getElementById('pos-equipment-model').value = row?.model || '';
        document.getElementById('pos-equipment-serial').value = row?.serialNumber || '';
        const macInput = document.getElementById('pos-equipment-mac');
        if (macInput) macInput.value = row?.macAddress || '';
        document.getElementById('pos-equipment-notes').value = row?.notes || '';
        document.getElementById('pos-equipment-active').checked = row ? row.isActive !== false : true;
        fillRegisterSelect(row?.posDeviceId);
        renderConfigFields(row?.equipmentType || 'register', row?.config || {});
        const msg = document.getElementById('pos-equipment-form-msg');
        if (msg) msg.textContent = '';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (opts.highlightField === 'mac' && macInput) {
            macInput.classList.add('pos-equipment-mac-highlight');
            setTimeout(() => {
                macInput.focus();
                macInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 200);
            macInput.addEventListener(
                'input',
                () => macInput.classList.remove('pos-equipment-mac-highlight'),
                { once: true }
            );
        }
    }

    function hideEquipmentEditor() {
        const card = document.getElementById('pos-equipment-editor-card');
        if (card) card.style.display = 'none';
    }

    async function ensureHardwareCatalog() {
        await loadEquipmentTypes();
        return true;
    }

    async function loadEquipmentTypes() {
        const res = await posApi('/equipment/types');
        equipmentTypes = res.types || [];
        fillTypeSelect('register');
    }

    async function loadRegistersForEquipment() {
        const res = await posApi('/devices');
        registerOptions = res.devices || [];
        fillRegisterSelect();
    }

    async function loadStoreNetwork() {
        const settingsMsg = document.getElementById('pos-network-settings-msg');
        try {
            const res = await posApi('/network');
            const settings = res.settings || {};
            const routerUrl = document.getElementById('pos-network-router-url');
            const gatewayIp = document.getElementById('pos-network-gateway-ip');
            const subnet = document.getElementById('pos-network-subnet');
            const notes = document.getElementById('pos-network-notes');
            if (routerUrl) routerUrl.value = settings.routerUrl || '';
            if (gatewayIp) gatewayIp.value = settings.gatewayIp || '';
            if (subnet) subnet.value = settings.subnetCidr || '';
            if (notes) notes.value = settings.notes || '';
            renderRegisterNetworkReports(res.registerReports || []);
            if (settingsMsg) settingsMsg.textContent = '';
            await refreshSetupAssistant();
        } catch (err) {
            if (settingsMsg) {
                settingsMsg.textContent = err.message || 'Failed to load network settings';
                settingsMsg.style.color = 'var(--error)';
            }
        }
    }

    function findRegisterEquipmentForDevice(posDeviceId) {
        return equipmentRows.find(
            (e) => e.equipmentType === 'register' && e.posDeviceId === Number(posDeviceId) && e.isActive
        );
    }

    function renderRegisterNetworkReports(reports) {
        const wrap = document.getElementById('pos-network-register-reports-wrap');
        const mount = document.getElementById('pos-network-register-reports');
        if (!wrap || !mount) return;
        if (!reports.length) {
            wrap.style.display = 'none';
            mount.innerHTML = '';
            return;
        }
        wrap.style.display = '';
        mount.innerHTML = `<div class="table-container"><table class="table"><thead><tr>
            <th>Register</th><th>Reported address</th><th>Last seen</th><th></th>
        </tr></thead><tbody>${reports
            .map((r) => {
                const regEq = findRegisterEquipmentForDevice(r.posDeviceId);
                const when = r.reportedAt ? new Date(r.reportedAt).toLocaleString() : '—';
                const applyBtn = regEq
                    ? `<button type="button" class="btn btn-secondary btn-sm" data-apply-register-ip="${regEq.id}" data-ip="${esc(r.reportedIp)}" data-mac="${esc(regEq.macAddress || '')}">Apply to ${esc(regEq.label)}</button>`
                    : '<span class="form-help">No register equipment assigned</span>';
                return `<tr>
                    <td>${esc(r.deviceLabel)}</td>
                    <td><code>${esc(r.reportedIp)}</code></td>
                    <td style="font-size:0.88rem;color:var(--gray-600);">${esc(when)}</td>
                    <td>${applyBtn}</td>
                </tr>`;
            })
            .join('')}</tbody></table></div>`;
        mount.querySelectorAll('[data-apply-register-ip]').forEach((btn) => {
            btn.addEventListener('click', () =>
                applyNetworkMatch(
                    Number(btn.getAttribute('data-apply-register-ip')),
                    btn.getAttribute('data-ip'),
                    btn.getAttribute('data-mac')
                )
            );
        });
    }

    function renderDhcpMatchResults(result) {
        dhcpMatchResults = result;
        const msg = document.getElementById('pos-network-parse-msg');
        const matchesMount = document.getElementById('pos-network-matches');
        const unmatchedMount = document.getElementById('pos-network-unmatched');
        const missingMacMount = document.getElementById('pos-network-missing-mac');
        const applyAllBtn = document.getElementById('pos-network-apply-all-btn');
        if (!matchesMount) return;

        const parsed = result?.parsedCount || 0;
        const matches = result?.matches || [];
        const macMatches = matches.filter((m) => m.confidence === 'mac');
        if (msg) {
            msg.textContent =
                parsed === 0
                    ? 'No address pairs found — check your paste format (name, IP, and hardware address per line).'
                    : `${parsed} device row(s) parsed · ${matches.length} match(es) (${macMatches.length} by hardware address)`;
            msg.style.color = parsed ? 'var(--gray-600)' : 'var(--error)';
        }
        if (applyAllBtn) {
            applyAllBtn.style.display = macMatches.length > 1 ? '' : 'none';
        }

        if (!matches.length) {
            matchesMount.innerHTML =
                parsed > 0
                    ? '<p class="form-help">No equipment matched. Add the hardware address (MAC) on each device under <strong>Edit equipment</strong>, then parse again.</p>'
                    : '';
        } else {
            matchesMount.innerHTML = `<table class="table"><thead><tr>
                <th>From router</th><th>Equipment</th><th>Current address</th><th>New address</th><th>Match</th><th></th>
            </tr></thead><tbody>${matches
                .map((m, idx) => {
                    const eq = m.equipment;
                    const dhcpLabel = [m.entry.hostname, m.entry.mac, m.entry.ip].filter(Boolean).join(' · ');
                    const sameIp = (m.currentIp || '') === (m.suggestedIp || '');
                    return `<tr>
                        <td style="font-size:0.88rem;">${esc(dhcpLabel)}</td>
                        <td><strong>${esc(eq.label)}</strong><br><span style="font-size:0.85rem;color:var(--gray-600);">${esc(eq.equipmentTypeLabel)}</span></td>
                        <td>${esc(m.currentIp || '—')}</td>
                        <td><code>${esc(m.suggestedIp)}</code></td>
                        <td style="font-size:0.85rem;">${esc(m.confidenceLabel)}</td>
                        <td style="white-space:nowrap;">
                            <button type="button" class="btn btn-primary btn-sm" data-apply-dhcp="${idx}"${sameIp ? ' disabled title="Already set"' : ''}>Apply</button>
                        </td>
                    </tr>`;
                })
                .join('')}</tbody></table>`;
            matchesMount.querySelectorAll('[data-apply-dhcp]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.getAttribute('data-apply-dhcp'));
                    const match = matches[idx];
                    if (!match) return;
                    applyNetworkMatch(match.equipment.id, match.suggestedIp, match.entry.mac);
                });
            });
        }

        const unmatched = result?.unmatchedEntries || [];
        if (unmatchedMount) {
            unmatchedMount.innerHTML = unmatched.length
                ? `<p class="form-help" style="margin:0;"><strong>${unmatched.length} router row(s) with no equipment match:</strong> ${unmatched
                      .map((u) => esc([u.hostname, u.mac, u.ip].filter(Boolean).join(' · ')))
                      .join('; ')}</p>`
                : '';
        }

        const missingMac = result?.equipmentWithoutMac || [];
        if (missingMacMount) {
            missingMacMount.innerHTML = missingMac.length
                ? `<div class="pos-network-alert-missing-mac">
                    <strong>Equipment missing hardware address (${missingMac.length})</strong>
                    <p class="form-help" style="margin:0.35rem 0 0;">Add the MAC from each device sticker so the pasted list can match automatically:</p>
                    <ul style="margin:0.35rem 0 0;padding-left:1.2rem;font-size:0.88rem;">${missingMac
                        .map(
                            (e) =>
                                `<li>${esc(e.label)} (${esc(e.equipmentTypeLabel)}) — <button type="button" class="btn btn-ghost btn-sm" data-edit-equipment-mac="${e.id}">Edit</button></li>`
                        )
                        .join('')}</ul>
                </div>`
                : '';
            missingMacMount.querySelectorAll('[data-edit-equipment-mac]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    await ensureHardwareCatalog();
                    const id = Number(btn.getAttribute('data-edit-equipment-mac'));
                    const row = equipmentRows.find((r) => r.id === id);
                    if (row) showEquipmentEditor(row);
                });
            });
        }
    }

    async function parseDhcpList() {
        const paste = document.getElementById('pos-network-dhcp-paste');
        const msg = document.getElementById('pos-network-parse-msg');
        const parseBtn = document.getElementById('pos-network-parse-btn');
        const text = paste?.value || '';
        if (!text.trim()) {
            if (msg) {
                msg.textContent = 'Paste the router\'s connected-device list first.';
                msg.style.color = 'var(--error)';
            }
            return;
        }
        if (msg) msg.textContent = 'Parsing…';
        if (parseBtn) parseBtn.disabled = true;
        try {
            const result = await posApi('/network/parse-dhcp', {
                method: 'POST',
                body: JSON.stringify({ dhcpText: text })
            });
            renderDhcpMatchResults(result);
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Parse failed';
                msg.style.color = 'var(--error)';
            }
        } finally {
            if (parseBtn) parseBtn.disabled = false;
        }
    }

    async function applyNetworkMatch(equipmentId, ip, mac) {
        try {
            await posApi('/network/apply', {
                method: 'POST',
                body: JSON.stringify({ equipmentId, ip, mac: mac || undefined })
            });
            window.adminApp.showToast(`IP ${ip} applied to equipment`, 'success');
            await loadEquipmentList();
            if (dhcpMatchResults) {
                const paste = document.getElementById('pos-network-dhcp-paste');
                if (paste?.value.trim()) {
                    const result = await posApi('/network/parse-dhcp', {
                        method: 'POST',
                        body: JSON.stringify({ dhcpText: paste.value })
                    });
                    renderDhcpMatchResults(result);
                }
            }
            await loadStoreNetwork();
        } catch (err) {
            window.adminApp.showToast(err.message || 'Apply failed', 'error');
        }
    }

    async function saveNetworkSettingsFromForm() {
        const msg = document.getElementById('pos-network-settings-msg');
        const saveBtn = document.getElementById('pos-network-save-btn');
        const body = {
            routerUrl: document.getElementById('pos-network-router-url')?.value,
            gatewayIp: document.getElementById('pos-network-gateway-ip')?.value,
            subnetCidr: document.getElementById('pos-network-subnet')?.value,
            notes: document.getElementById('pos-network-notes')?.value
        };
        if (saveBtn) saveBtn.disabled = true;
        try {
            await posApi('/network', { method: 'PUT', body: JSON.stringify(body) });
            if (msg) {
                msg.textContent = 'Saved';
                msg.style.color = 'var(--success)';
            }
            window.adminApp.showToast('Network settings saved', 'success');
            await loadStoreNetwork();
            return true;
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || 'Save failed';
                msg.style.color = 'var(--error)';
            }
            window.adminApp.showToast(err.message || 'Save failed', 'error');
            return false;
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    function loadSetupClientState() {
        try {
            const raw = localStorage.getItem(SETUP_STORAGE_KEY);
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

    function saveSetupClientState(state) {
        localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(state));
    }

    function resetSetupClientState() {
        localStorage.removeItem(SETUP_STORAGE_KEY);
        localStorage.removeItem(SETUP_CHAT_STORAGE_KEY);
        setupAssistantViewStepId = null;
        setupAiMessages = [];
        setupAiCoachedSteps = new Set();
        setupLastBriefingFingerprint = '';
    }

    function loadSetupChatHistory() {
        try {
            const raw = localStorage.getItem(SETUP_CHAT_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.slice(-40) : [];
        } catch {
            return [];
        }
    }

    function saveSetupChatHistory() {
        localStorage.setItem(SETUP_CHAT_STORAGE_KEY, JSON.stringify(setupAiMessages.slice(-40)));
    }

    function appendAiMessage(role, content, extras = {}) {
        if (extras.kind === 'briefing') {
            setupAiMessages = setupAiMessages.filter((m) => m.kind !== 'briefing');
        }
        setupAiMessages.push({
            role,
            content: String(content || ''),
            suggestedActions: extras.suggestedActions || [],
            kind: extras.kind || null,
            ts: Date.now()
        });
        saveSetupChatHistory();
        renderAiChatLog();
    }

    function renderSetupStatusPanel(report) {
        const panel = document.getElementById('pos-network-assistant-status');
        const headline = document.getElementById('pos-network-assistant-status-headline');
        const next = document.getElementById('pos-network-assistant-status-next');
        const missingMount = document.getElementById('pos-network-assistant-status-missing');
        const doneMount = document.getElementById('pos-network-assistant-status-done');
        if (!panel || !report) return;
        panel.style.display = '';

        if (headline) headline.textContent = report.headline || 'Setup status';
        if (next) {
            if (report.allDone) {
                next.textContent = 'Everything required is in place. Optional: run a backup internet test if your router supports it.';
            } else if (report.nextStep) {
                next.innerHTML = `<strong>Next step:</strong> ${esc(report.nextStep.title)} — ${esc(report.nextStep.summary || '')}`;
            } else {
                next.textContent = 'Work through the steps below.';
            }
        }

        const missing = report.missingItems || [];
        if (missingMount) {
            missingMount.innerHTML = missing.length
                ? missing
                      .map((m) => {
                          const fixBtn = m.actionId
                              ? ` <button type="button" class="btn btn-ghost btn-sm" data-status-fix="${esc(m.actionId)}"${m.equipmentId ? ` data-equipment-id="${m.equipmentId}"` : ''}>Fix</button>`
                              : '';
                          return `<li>${esc(m.label)}${m.detail ? ` <span style="color:var(--gray-600);">(${esc(m.detail)})</span>` : ''}${fixBtn}</li>`;
                      })
                      .join('')
                : '<li class="is-empty" style="list-style:none;padding:0;">Nothing flagged right now.</li>';
            missingMount.querySelectorAll('[data-status-fix]').forEach((btn) => {
                btn.addEventListener('click', () =>
                    runSetupAction(btn.getAttribute('data-status-fix'), {
                        equipmentId: btn.getAttribute('data-equipment-id')
                    })
                );
            });
        }

        const done = report.completedItems || [];
        if (doneMount) {
            doneMount.innerHTML = done.length
                ? done.map((d) => `<li>${esc(d)}</li>`).join('')
                : '<li class="is-empty" style="list-style:none;padding:0;">Nothing completed yet.</li>';
        }
    }

    async function fetchAiBriefing(force = false) {
        const report = setupAssistantSnapshot?.statusReport;
        if (!report) return;
        const fp = report.fingerprint || '';
        if (!force && fp && fp === setupLastBriefingFingerprint) return;

        setupLastBriefingFingerprint = fp;
        setupAiCoachLoading = true;

        const thinkingId = `thinking-brief-${Date.now()}`;
        const logEl = document.getElementById('pos-network-assistant-chat-log');
        if (logEl) {
            logEl.insertAdjacentHTML(
                'beforeend',
                `<div class="pos-network-assistant-chat-bubble is-thinking" id="${thinkingId}">Reviewing your current setup…</div>`
            );
            logEl.scrollTop = logEl.scrollHeight;
        }

        try {
            const res = await posApi('/network/setup-assistant/briefing', {
                method: 'POST',
                body: JSON.stringify({ clientState: loadSetupClientState() })
            });
            document.getElementById(thinkingId)?.remove();
            appendAiMessage('assistant', res.reply || '', {
                kind: 'briefing',
                suggestedActions: res.suggestedActions || []
            });
            if (res.autoAction) {
                await runSetupAction(res.autoAction, {
                    equipmentId: res.autoActionEquipmentId
                });
            } else if (res.highlight) {
                applyAiHighlight(res.highlight);
            }
        } catch (err) {
            document.getElementById(thinkingId)?.remove();
            const fallback = setupAssistantSnapshot?.statusReport;
            if (fallback) {
                const missingLines = (fallback.missingItems || [])
                    .map((m) => `• ${m.label}`)
                    .join('\n');
                appendAiMessage(
                    'assistant',
                    `${fallback.headline}\n\n${missingLines ? `Still missing:\n${missingLines}\n\n` : ''}Next: ${fallback.nextStep?.title || 'Continue the steps below.'}`,
                    {
                        kind: 'briefing',
                        suggestedActions: fallback.primaryMissing
                            ? [
                                  {
                                      id: fallback.primaryMissing.actionId,
                                      label: 'Do next step',
                                      equipmentId: fallback.primaryMissing.equipmentId,
                                      primary: true
                                  }
                              ]
                            : []
                    }
                );
            } else {
                appendAiMessage('assistant', err.message || 'Could not load setup briefing.', { kind: 'briefing' });
            }
        } finally {
            setupAiCoachLoading = false;
        }
    }

    function renderAiChatLog() {
        const log = document.getElementById('pos-network-assistant-chat-log');
        if (!log) return;
        if (!setupAiMessages.length) {
            log.innerHTML =
                '<div class="pos-network-assistant-chat-bubble is-assistant">Reviewing your store setup…</div>';
            return;
        }
        log.innerHTML = setupAiMessages
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
                                  const attrs = [`data-ai-action="${esc(a.id)}"`, `class="${btnCls}"`, `data-msg-idx="${idx}"`];
                                  if (a.equipmentId) attrs.push(`data-equipment-id="${a.equipmentId}"`);
                                  return `<button type="button" ${attrs.join(' ')}>${esc(a.label)}</button>`;
                              })
                              .join('')}</div>`
                        : '';
                return `<div class="pos-network-assistant-chat-bubble ${cls}">${esc(msg.content)}${actions}</div>`;
            })
            .join('');
        log.querySelectorAll('[data-ai-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                runSetupAction(btn.getAttribute('data-ai-action'), {
                    equipmentId: btn.getAttribute('data-equipment-id')
                });
            });
        });
        log.scrollTop = log.scrollHeight;
    }

    function updateAiBanner() {
        const banner = document.getElementById('pos-network-assistant-ai-banner');
        const tag = document.getElementById('pos-network-assistant-model-tag');
        if (tag) {
            tag.textContent = setupAiEnabled ? `(AI · ${setupAiModel || 'connected'})` : '(AI not connected)';
        }
        if (!banner) return;
        if (setupAiEnabled) {
            banner.style.display = 'none';
            return;
        }
        banner.style.display = '';
        banner.innerHTML =
            '<strong>AI is not connected yet.</strong> Add <code>OPENAI_API_KEY</code> to your backend <code>.env</code> file and restart the server. Steps and buttons still work; chat needs the API key.';
    }

    async function handleAiResponse(result) {
        if (!result) return;
        appendAiMessage('assistant', result.reply || result.answer || '', {
            suggestedActions: result.suggestedActions || []
        });
        if (result.highlight) {
            applyAiHighlight(result.highlight);
        }
        if (result.autoAction) {
            await runSetupAction(result.autoAction, {
                equipmentId: result.autoActionEquipmentId
            });
        }
    }

    function applyAiHighlight(target) {
        switch (target) {
            case 'network_form':
                scrollToNetworkForm();
                break;
            case 'equipment':
                scrollToEquipmentSection();
                break;
            case 'paste':
                focusDhcpPaste();
                break;
            default:
                break;
        }
    }

    async function fetchAiCoachForStep(stepId, force = false) {
        if (!stepId || setupAiCoachLoading) return;
        if (!force && setupAiCoachedSteps.has(stepId)) return;

        const log = document.getElementById('pos-network-assistant-chat-log');
        if (log && !setupAiMessages.length) renderAiChatLog();

        if (!setupAiEnabled) {
            const step = setupAssistantSnapshot?.steps?.find((s) => s.id === stepId);
            if (step && !setupAiCoachedSteps.has(stepId)) {
                appendAiMessage('assistant', step.message || step.summary, {
                    suggestedActions: step.actions || []
                });
                setupAiCoachedSteps.add(stepId);
            }
            return;
        }

        setupAiCoachLoading = true;
        const thinkingId = `thinking-${Date.now()}`;
        const logEl = document.getElementById('pos-network-assistant-chat-log');
        if (logEl) {
            logEl.insertAdjacentHTML(
                'beforeend',
                `<div class="pos-network-assistant-chat-bubble is-thinking" id="${thinkingId}">Thinking…</div>`
            );
            logEl.scrollTop = logEl.scrollHeight;
        }
        try {
            const res = await posApi('/network/setup-assistant/coach', {
                method: 'POST',
                body: JSON.stringify({ stepId, clientState: loadSetupClientState() })
            });
            document.getElementById(thinkingId)?.remove();
            setupAiCoachedSteps.add(stepId);
            await handleAiResponse(res);
        } catch (err) {
            document.getElementById(thinkingId)?.remove();
            const step = setupAssistantSnapshot?.steps?.find((s) => s.id === stepId);
            appendAiMessage(
                'assistant',
                err.message || 'I could not reach the AI service. Use the action buttons below, or add OPENAI_API_KEY to the server.',
                { suggestedActions: step?.actions || [] }
            );
            setupAiCoachedSteps.add(stepId);
        } finally {
            setupAiCoachLoading = false;
        }
    }

    async function sendAiChat(userMessage) {
        const text = String(userMessage || '').trim();
        if (!text) return;

        appendAiMessage('user', text);
        const input = document.getElementById('pos-network-assistant-chat-input');
        const sendBtn = document.getElementById('pos-network-assistant-chat-send');
        if (input) input.value = '';
        if (sendBtn) sendBtn.disabled = true;

        const history = setupAiMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .slice(0, -1)
            .map((m) => ({ role: m.role, content: m.content }));

        const logEl = document.getElementById('pos-network-assistant-chat-log');
        const thinkingId = `thinking-${Date.now()}`;
        if (logEl) {
            logEl.insertAdjacentHTML(
                'beforeend',
                `<div class="pos-network-assistant-chat-bubble is-thinking" id="${thinkingId}">Thinking…</div>`
            );
            logEl.scrollTop = logEl.scrollHeight;
        }

        try {
            const endpoint = setupAiEnabled ? '/network/setup-assistant/chat' : '/network/setup-assistant/ask';
            const body = setupAiEnabled
                ? { message: text, messages: history, clientState: loadSetupClientState() }
                : { question: text, messages: history, clientState: loadSetupClientState() };

            const res = await posApi(endpoint, { method: 'POST', body: JSON.stringify(body) });
            document.getElementById(thinkingId)?.remove();
            await handleAiResponse({
                reply: res.reply || res.answer,
                suggestedActions: res.suggestedActions,
                autoAction: res.autoAction,
                autoActionEquipmentId: res.autoActionEquipmentId,
                highlight: res.highlight
            });
            await refreshSetupAssistant({ skipBriefing: true });
        } catch (err) {
            document.getElementById(thinkingId)?.remove();
            appendAiMessage('assistant', err.message || 'Something went wrong. Please try again.');
        } finally {
            if (sendBtn) sendBtn.disabled = false;
            if (input) input.focus();
        }
    }

    async function refreshSetupAssistant(opts = {}) {
        const mount = document.getElementById('pos-network-setup-assistant');
        if (!mount) return;
        const clientState = loadSetupClientState();
        const qs = new URLSearchParams();
        if (clientState.skipped.length) qs.set('skipped', clientState.skipped.join(','));
        if (clientState.routerMarkedDone) qs.set('routerMarkedDone', '1');
        if (clientState.backupTestDone) qs.set('backupTestDone', '1');
        try {
            const res = await posApi('/network/setup-assistant?' + qs.toString());
            setupAssistantSnapshot = res.assistant || null;
            setupAiEnabled = Boolean(res.ai?.enabled);
            setupAiModel = res.ai?.model || '';
            updateAiBanner();
            if (
                setupAssistantViewStepId &&
                !setupAssistantSnapshot?.steps?.some((s) => s.id === setupAssistantViewStepId)
            ) {
                setupAssistantViewStepId = null;
            }
            renderSetupAssistant();
            if (setupAssistantSnapshot?.statusReport) {
                renderSetupStatusPanel(setupAssistantSnapshot.statusReport);
            }
            notifyTroubleshootRefresh();
            if (!opts.skipBriefing) {
                await fetchAiBriefing(Boolean(opts.forceBriefing));
            } else if (!opts.skipCoach) {
                const step = getSetupStepView();
                if (step) await fetchAiCoachForStep(step.id);
            }
        } catch (err) {
            const progress = document.getElementById('pos-network-assistant-progress');
            if (progress) progress.textContent = err.message || 'Could not load setup assistant';
        }
    }

    function getSetupStepView() {
        const snap = setupAssistantSnapshot;
        if (!snap?.steps?.length) return null;
        const preferred = setupAssistantViewStepId || snap.currentStepId;
        return snap.steps.find((s) => s.id === preferred) || snap.steps.find((s) => s.status !== 'complete' && s.status !== 'skipped') || snap.steps[0];
    }

    function renderSetupAssistant() {
        const snap = setupAssistantSnapshot;
        const progress = document.getElementById('pos-network-assistant-progress');
        const stepsMount = document.getElementById('pos-network-assistant-steps');
        const checksMount = document.getElementById('pos-network-assistant-checks');
        const actionsMount = document.getElementById('pos-network-assistant-actions');
        const body = document.getElementById('pos-network-assistant-body');
        if (!snap || !progress || !stepsMount || !checksMount || !actionsMount || !body) return;

        const doneCount = snap.steps.filter((s) => s.status === 'complete').length;
        const skippedCount = snap.steps.filter((s) => s.status === 'skipped').length;
        progress.textContent = snap.allDone
            ? 'All set — network setup is complete.'
            : `Step ${doneCount + skippedCount + (snap.currentStepId ? 1 : 0)} of ${snap.steps.length} · ${doneCount} done`;

        stepsMount.innerHTML = snap.steps
            .map((step, idx) => {
                const classes = ['pos-network-assistant-step-pill'];
                const view = getSetupStepView();
                if (view?.id === step.id) classes.push('is-current');
                if (step.status === 'complete') classes.push('is-complete');
                if (step.status === 'skipped') classes.push('is-skipped');
                return `<button type="button" class="${classes.join(' ')}" data-setup-step="${esc(step.id)}">${idx + 1}. ${esc(step.title)}</button>`;
            })
            .join('');

        stepsMount.querySelectorAll('[data-setup-step]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                setupAssistantViewStepId = btn.getAttribute('data-setup-step');
                renderSetupAssistant();
                await fetchAiCoachForStep(setupAssistantViewStepId, true);
            });
        });

        const step = getSetupStepView();
        if (!step) return;

        let banner = '';
        if (snap.allDone) {
            banner =
                '<div class="pos-network-assistant-done-banner">You are done with network setup. Registers and printers should keep the same addresses every time they connect.</div>';
        }
        const existingBanner = body.querySelector('.pos-network-assistant-done-banner');
        if (existingBanner) existingBanner.remove();
        if (banner) body.insertAdjacentHTML('afterbegin', banner);

        checksMount.innerHTML = (step.checks || [])
            .map((check) => {
                const cls = check.done ? 'is-done' : 'is-pending';
                let editBtn = '';
                if (!check.done && check.equipmentId) {
                    editBtn = ` <button type="button" class="btn btn-ghost btn-sm" data-setup-edit-eq="${check.equipmentId}">Edit</button>`;
                }
                return `<li class="${cls}">${esc(check.label)}${editBtn}</li>`;
            })
            .join('');

        checksMount.querySelectorAll('[data-setup-edit-eq]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                await ensureHardwareCatalog();
                const id = Number(btn.getAttribute('data-setup-edit-eq'));
                const row = equipmentRows.find((r) => r.id === id);
                if (row) showEquipmentEditor(row, { highlightField: 'mac' });
            });
        });

        const actionButtons = (step.actions || [])
            .map((action) => {
                const cls = action.primary ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
                const attrs = [`data-setup-action="${esc(action.id)}"`, `class="${cls}"`];
                if (action.equipmentId) attrs.push(`data-equipment-id="${action.equipmentId}"`);
                return `<button type="button" ${attrs.join(' ')}>${esc(action.label)}</button>`;
            })
            .join('');

        const skipBtn =
            step.canSkip && step.status !== 'complete' && step.status !== 'skipped'
                ? `<button type="button" class="btn btn-ghost btn-sm" data-setup-skip="${esc(step.id)}">Skip this step</button>`
                : '';

        actionsMount.innerHTML = actionButtons + skipBtn;

        actionsMount.querySelectorAll('[data-setup-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                runSetupAction(btn.getAttribute('data-setup-action'), {
                    equipmentId: btn.getAttribute('data-equipment-id')
                });
            });
        });
        actionsMount.querySelectorAll('[data-setup-skip]').forEach((btn) => {
            btn.addEventListener('click', () => skipSetupStep(btn.getAttribute('data-setup-skip')));
        });
    }

    function skipSetupStep(stepId) {
        const state = loadSetupClientState();
        if (!state.skipped.includes(stepId)) state.skipped.push(stepId);
        saveSetupClientState(state);
        setupAssistantViewStepId = null;
        refreshSetupAssistant();
        window.adminApp?.showToast?.('Step skipped — you can come back to it anytime', 'success');
    }

    function scrollToNetworkForm() {
        document.getElementById('pos-network-settings-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function scrollToEquipmentSection() {
        document.getElementById('pos-equipment-list')?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function focusDhcpPaste() {
        const paste = document.getElementById('pos-network-dhcp-paste');
        paste?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        paste?.focus();
    }

    async function runSetupAction(actionId, meta = {}) {
        const state = loadSetupClientState();
        switch (actionId) {
            case 'save_settings':
                scrollToNetworkForm();
                if (await saveNetworkSettingsFromForm()) {
                    setupAiCoachedSteps.clear();
                    setupAssistantViewStepId = null;
                    setupLastBriefingFingerprint = '';
                }
                break;
            case 'focus_settings':
                scrollToNetworkForm();
                break;
            case 'add_equipment':
                await ensureHardwareCatalog();
                scrollToEquipmentSection();
                showEquipmentEditor(null);
                break;
            case 'scroll_equipment':
                scrollToEquipmentSection();
                break;
            case 'edit_next_mac': {
                await ensureHardwareCatalog();
                const id = Number(meta.equipmentId);
                const row = equipmentRows.find((r) => r.id === id);
                if (row) showEquipmentEditor(row, { highlightField: 'mac' });
                else scrollToEquipmentSection();
                break;
            }
            case 'router_done':
                state.routerMarkedDone = true;
                saveSetupClientState(state);
                setupAiCoachedSteps.clear();
                setupAssistantViewStepId = null;
                setupLastBriefingFingerprint = '';
                await refreshSetupAssistant({ forceBriefing: true });
                window.adminApp?.showToast?.('Great — move on to pasting from the router', 'success');
                break;
            case 'focus_paste':
                focusDhcpPaste();
                break;
            case 'parse_list':
                focusDhcpPaste();
                await parseDhcpList();
                await refreshSetupAssistant();
                break;
            case 'apply_all':
                await applyAllMacMatches({ fromAssistant: true });
                setupAiCoachedSteps.clear();
                setupAssistantViewStepId = null;
                setupLastBriefingFingerprint = '';
                await refreshSetupAssistant({ forceBriefing: true });
                break;
            case 'backup_done':
                state.backupTestDone = true;
                saveSetupClientState(state);
                setupAiCoachedSteps.clear();
                setupAssistantViewStepId = null;
                await refreshSetupAssistant();
                window.adminApp?.showToast?.('Setup complete', 'success');
                break;
            default:
                break;
        }
    }

    async function askSetupAssistant(question) {
        return sendAiChat(question);
    }

    function bindSetupAssistant() {
        if (setupAssistantBound) return;
        setupAssistantBound = true;
        setupAiMessages = loadSetupChatHistory();
        renderAiChatLog();
        document.getElementById('pos-network-assistant-restart')?.addEventListener('click', async () => {
            const ok = await window.adminApp?.showAdminConfirm?.({
                title: 'Start setup over?',
                message: 'This clears skipped steps, chat history, and router checkmarks. Saved equipment and network settings stay as they are.',
                confirmLabel: 'Start over',
                cancelLabel: 'Cancel'
            });
            if (!ok) return;
            resetSetupClientState();
            renderAiChatLog();
            await refreshSetupAssistant();
        });
        document.getElementById('pos-network-assistant-chat-form')?.addEventListener('submit', (ev) => {
            ev.preventDefault();
            const input = document.getElementById('pos-network-assistant-chat-input');
            sendAiChat(input?.value || '');
        });
    }

    async function applyAllMacMatches(opts = {}) {
        if (!dhcpMatchResults?.matches?.length) return;
        const macMatches = dhcpMatchResults.matches.filter((m) => m.confidence === 'mac');
        if (!macMatches.length) {
            if (opts.fromAssistant) {
                window.adminApp.showToast('Parse the router list first — there are no matches to apply yet', 'error');
            }
            return;
        }
        if (!opts.fromAssistant) {
            const ok = await window.adminApp?.showAdminConfirm?.({
                title: 'Apply all matches?',
                message: `Update the network address on ${macMatches.length} equipment record(s) from the pasted list?`,
                confirmLabel: 'Apply all',
                cancelLabel: 'Cancel'
            });
            if (!ok) return;
        } else if (macMatches.length > 1) {
            const ok = await window.adminApp?.showAdminConfirm?.({
                title: 'Apply all matches?',
                message: `Update ${macMatches.length} equipment records with addresses from the router list?`,
                confirmLabel: 'Apply all',
                cancelLabel: 'Cancel'
            });
            if (!ok) return;
        }
        try {
            const res = await posApi('/network/apply-all', {
                method: 'POST',
                body: JSON.stringify({
                    matches: macMatches.map((m) => ({
                        equipmentId: m.equipment.id,
                        ip: m.suggestedIp,
                        mac: m.entry.mac
                    }))
                })
            });
            window.adminApp.showToast(`Applied ${res.appliedCount || 0} IP assignment(s)`, 'success');
            if (res.errors?.length) {
                window.adminApp.showToast(`${res.errors.length} assignment(s) failed`, 'error');
            }
            await loadEquipmentList();
            await parseDhcpList();
            await loadStoreNetwork();
            await refreshSetupAssistant();
        } catch (err) {
            window.adminApp.showToast(err.message || 'Apply all failed', 'error');
        }
    }

    function bindStoreNetwork() {
        if (networkBound) return;
        networkBound = true;
        bindSetupAssistant();
        document.getElementById('pos-network-settings-form')?.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            await saveNetworkSettingsFromForm();
        });
        document.getElementById('pos-network-parse-btn')?.addEventListener('click', parseDhcpList);
        document.getElementById('pos-network-apply-all-btn')?.addEventListener('click', () => applyAllMacMatches());
    }

    async function loadRegisterProfiles() {
        const mount = document.getElementById('pos-equipment-register-profiles');
        if (!mount) return;
        const activeRegisters = registerOptions.filter((d) => d.isActive);
        if (!activeRegisters.length) {
            mount.innerHTML = '';
            return;
        }
        mount.innerHTML = '<p class="form-help">Loading register wiring…</p>';
        try {
            const profiles = await Promise.all(
                activeRegisters.map(async (reg) => {
                    const res = await posApi('/equipment/register-profile/' + reg.id);
                    return { reg, profile: res.profile };
                })
            );
            mount.innerHTML = profiles
                .map(({ reg, profile }) => {
                    const status = profile.ready
                        ? '<span style="color:var(--success);">Ready</span>'
                        : '<span style="color:var(--warning,#b45309);">Needs setup</span>';
                    const issues =
                        profile.issues?.length
                            ? `<ul style="margin:0.35rem 0 0;padding-left:1.1rem;font-size:0.85rem;color:var(--gray-600);">${profile.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
                            : '';
                    const parts = [
                        profile.register ? `Register: ${esc(profile.register.manufacturer)} ${esc(profile.register.model)}` : null,
                        profile.register?.serialNumber
                            ? `Serial: ${esc(profile.register.serialNumber)}`
                            : null,
                        profile.register?.address ? `IP: ${esc(profile.register.address)}` : null,
                        profile.cardTerminal ? `Terminal: ${esc(profile.cardTerminal.manufacturer)} ${esc(profile.cardTerminal.model)}` : null,
                        profile.cardTerminal?.terminalAddress
                            ? `Terminal IP: ${esc(profile.cardTerminal.terminalAddress)}`
                            : null,
                        profile.receiptPrinter ? `Printer: ${esc(profile.receiptPrinter.manufacturer)} ${esc(profile.receiptPrinter.model)}` : null,
                        profile.receiptPrinter?.config?.address
                            ? `Printer IP: ${esc(profile.receiptPrinter.config.address)}`
                            : null,
                        profile.cashDrawer ? `Drawer: ${esc(profile.cashDrawer.label)}` : null,
                        profile.customerDisplay ? `Display: ${esc(profile.customerDisplay.label)}` : null,
                        profile.labelPrinter ? `Labels: ${esc(profile.labelPrinter.label)}` : null,
                        profile.scale ? `Scale: ${esc(profile.scale.label)}` : null
                    ]
                        .filter(Boolean)
                        .join(' · ');
                    return `<div class="pos-equipment-profile-card">
                        <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
                            <strong>${esc(reg.deviceLabel)}</strong>
                            ${status}
                        </div>
                        <p style="margin:0.35rem 0 0;font-size:0.88rem;color:var(--gray-600);">${parts || 'No equipment assigned yet.'}</p>
                        ${issues}
                    </div>`;
                })
                .join('');
        } catch (err) {
            mount.innerHTML = `<p style="color:var(--error);">${esc(err.message)}</p>`;
        }
    }

    async function loadEquipmentList() {
        const mount = document.getElementById('pos-equipment-list');
        if (!mount) return;
        mount.innerHTML = '<p class="form-help">Loading equipment…</p>';
        try {
            const res = await posApi('/equipment');
            equipmentRows = res.equipment || [];
            if (!equipmentRows.length) {
                mount.innerHTML =
                    '<p style="color:var(--gray-500);">No equipment yet. Click <strong>Add equipment</strong> to register your POS, terminal, printer, and drawer.</p>';
                await loadRegisterProfiles();
                await loadStoreNetwork();
                return;
            }
            mount.innerHTML = `<table class="table"><thead><tr>
                <th>Name</th><th>Type</th><th>Brand / model</th><th>MAC / ID / IP</th><th>Register</th><th>Status</th><th></th>
            </tr></thead><tbody>${equipmentRows
                .map((e) => {
                    const idIp = [e.macAddress, e.serialNumber, e.config?.address].filter(Boolean).join(' · ') || '—';
                    const brandModel = [e.manufacturer, e.model].filter(Boolean).join(' ') || '—';
                    return `<tr>
                        <td><strong>${esc(e.label)}</strong></td>
                        <td>${esc(e.equipmentTypeLabel)}</td>
                        <td style="font-size:0.88rem;color:var(--gray-600);">${esc(brandModel)}</td>
                        <td style="font-size:0.88rem;color:var(--gray-600);">${esc(idIp)}</td>
                        <td>${esc(e.posDeviceLabel || '—')}</td>
                        <td>${e.isActive ? '<span style="color:var(--success);">Active</span>' : 'Inactive'}</td>
                        <td style="white-space:nowrap;">
                            <button type="button" class="btn btn-secondary btn-sm" data-edit-equipment="${e.id}">Edit</button>
                            <button type="button" class="btn btn-ghost btn-sm" data-delete-equipment="${e.id}">Delete</button>
                        </td>
                    </tr>`;
                })
                .join('')}</tbody></table>`;
            mount.querySelectorAll('[data-edit-equipment]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = Number(btn.getAttribute('data-edit-equipment'));
                    const row = equipmentRows.find((r) => r.id === id);
                    if (row) showEquipmentEditor(row);
                });
            });
            mount.querySelectorAll('[data-delete-equipment]').forEach((btn) => {
                btn.addEventListener('click', () => deleteEquipment(btn.getAttribute('data-delete-equipment')));
            });
            await loadRegisterProfiles();
            await loadStoreNetwork();
        } catch (err) {
            mount.innerHTML = `<p style="color:var(--error);">${esc(err.message)}</p>`;
        }
    }

    async function deleteEquipment(id) {
        const ok = await window.adminApp?.showAdminConfirm?.({
            title: 'Delete equipment?',
            message: 'This cannot be undone.',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            danger: true
        });
        if (!ok) return;
        try {
            await posApi('/equipment/' + id, { method: 'DELETE' });
            window.adminApp.showToast('Equipment deleted', 'success');
            hideEquipmentEditor();
            await loadEquipmentList();
        } catch (err) {
            window.adminApp.showToast(err.message || 'Delete failed', 'error');
        }
    }

    function bindPosTabs() {
        if (tabsBound) return;
        tabsBound = true;
        bindStoreNetwork();
        document.querySelectorAll('[data-pos-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-pos-tab');
                document.querySelectorAll('[data-pos-tab]').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('[data-pos-panel]').forEach((p) => {
                    p.style.display = p.getAttribute('data-pos-panel') === tab ? '' : 'none';
                });
                if (tab === 'equipment') {
                    loadRegistersForEquipment();
                    ensureHardwareCatalog().then(() => loadEquipmentList());
                }
                if (tab === 'registers' && window.adminApp?.loadPosDevices) {
                    window.adminApp.loadPosDevices();
                }
                if (tab === 'license' && window.adminApp?.loadPosLicense) {
                    window.adminApp.loadPosLicense();
                }
            });
        });

        document.getElementById('pos-equipment-add-btn')?.addEventListener('click', async () => {
            await ensureHardwareCatalog();
            showEquipmentEditor(null);
        });

        document.getElementById('pos-equipment-cancel-btn')?.addEventListener('click', hideEquipmentEditor);

        document.getElementById('pos-equipment-type')?.addEventListener('change', (e) => {
            const typeId = e.target.value;
            const help = document.getElementById('pos-equipment-type-help');
            const meta = typeMeta(typeId);
            if (help) help.textContent = meta?.description || '';
            renderConfigFields(typeId, {});
        });

        ['pos-equipment-manufacturer', 'pos-equipment-model'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', () => {
                const typeId = document.getElementById('pos-equipment-type')?.value;
                updatePayPointFormHints(typeId);
            });
        });

        document.getElementById('pos-equipment-register')?.addEventListener('change', () => {
            const typeId = document.getElementById('pos-equipment-type')?.value;
            renderConfigFields(typeId, readConfigFromForm());
        });

        const eqForm = document.getElementById('pos-equipment-form');
        if (eqForm && !eqForm.dataset.bound) {
            eqForm.dataset.bound = '1';
            eqForm.addEventListener('submit', async (ev) => {
                ev.preventDefault();
                const msg = document.getElementById('pos-equipment-form-msg');
                if (msg) msg.textContent = '';
                const id = document.getElementById('pos-equipment-id')?.value;
                const typeId = document.getElementById('pos-equipment-type')?.value;
                const config = readConfigFromForm();
                const body = {
                    equipmentType: typeId,
                    label: document.getElementById('pos-equipment-label')?.value,
                    manufacturer: document.getElementById('pos-equipment-manufacturer')?.value,
                    model: document.getElementById('pos-equipment-model')?.value,
                    serialNumber: document.getElementById('pos-equipment-serial')?.value,
                    macAddress: document.getElementById('pos-equipment-mac')?.value,
                    posDeviceId: document.getElementById('pos-equipment-register')?.value || null,
                    notes: document.getElementById('pos-equipment-notes')?.value,
                    isActive: document.getElementById('pos-equipment-active')?.checked,
                    config
                };
                try {
                    if (id) {
                        await posApi('/equipment/' + id, { method: 'PUT', body: JSON.stringify(body) });
                    } else {
                        await posApi('/equipment', { method: 'POST', body: JSON.stringify(body) });
                    }
                    window.adminApp.showToast('Equipment saved', 'success');
                    hideEquipmentEditor();
                    await loadEquipmentList();
                    await refreshSetupAssistant();
                    notifyTroubleshootRefresh();
                } catch (err) {
                    if (msg) {
                        msg.textContent = err.message || 'Save failed';
                        msg.style.color = 'var(--error)';
                    }
                    window.adminApp.showToast(err.message || 'Save failed', 'error');
                }
            });
        }
    }

    function notifyTroubleshootRefresh() {
        if (window.AdminPosTroubleshoot?.refresh) {
            window.AdminPosTroubleshoot.refresh({ skipBriefing: true });
        }
    }

    function switchPosTab(tab) {
        const btn = document.querySelector(`[data-pos-tab="${tab}"]`);
        if (btn) btn.click();
    }

    window.AdminPosHub = {
        async init() {
            bindPosTabs();
            try {
                await ensureHardwareCatalog();
            } catch {
                /* optional until equipment tab opened */
            }
        },
        refreshEquipment() {
            return loadEquipmentList();
        },
        switchPosTab,
        runSetupAction,
        async openEquipmentEditor(equipmentId, opts = {}) {
            switchPosTab('equipment');
            await ensureHardwareCatalog();
            if (!equipmentRows.length) await loadEquipmentList();
            const row = equipmentRows.find((r) => r.id === Number(equipmentId));
            if (row) showEquipmentEditor(row, opts);
            else scrollToEquipmentSection();
        }
    };
})();
