/**
 * Clickable column sorting for admin tables.
 *
 * Usage:
 *   AdminTableSort.bind(table, { mode: 'client' });
 *   AdminTableSort.bind(table, {
 *     mode: 'server',
 *     key: 'name',
 *     dir: 'asc',
 *     onSort(key, dir) { ... reload list ... }
 *   });
 *
 * Auto-init prepares every admin data table: headers get data-sort unless
 * they are Actions, empty, or checkbox columns. Client-sorts the current
 * (filtered/paged) rows. Optional data-sort / data-sort-type / data-sort-value
 * still win when already present.
 */
(function (global) {
    'use strict';

    const sortMemory = new Map();
    const EDITOR_TABLE_IDS = {
        'vendors-lines-table': true,
    };
    /** >0 while we own DOM writes. Kept high until after MO microtasks flush. */
    let suppressMutations = 0;
    const pendingTables = new Set();
    let scanTimer = null;
    let observerStarted = false;

    function withSuppressedMutations(fn) {
        suppressMutations += 1;
        try {
            return fn();
        } finally {
            // MutationObserver callbacks are async. Dropping the flag in the same
            // turn let our own tbody reorders re-enter prepareAll → re-sort loops
            // that blocked the main thread for multi-second INP input delay.
            const release = function () {
                const obs = document._adminSortObserver;
                if (obs && typeof obs.takeRecords === 'function') {
                    obs.takeRecords();
                }
                suppressMutations = Math.max(0, suppressMutations - 1);
            };
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(function () {
                    queueMicrotask(release);
                });
            } else {
                setTimeout(release, 0);
            }
        }
    }

    function parseCellValue(td, type) {
        if (!td) return type === 'number' || type === 'date' ? 0 : '';
        const raw = td.getAttribute('data-sort-value');
        if (raw != null && raw !== '') {
            if (type === 'number') {
                const n = Number(raw);
                return Number.isFinite(n) ? n : 0;
            }
            if (type === 'date') {
                const t = Date.parse(raw);
                return Number.isFinite(t) ? t : 0;
            }
            return String(raw).toLowerCase();
        }
        const text = String(td.textContent || '').replace(/\s+/g, ' ').trim();
        if (type === 'number') {
            const m = text.replace(/,/g, '').match(/-?\$?[0-9]+(?:\.[0-9]+)?/);
            if (!m) return 0;
            const n = parseFloat(String(m[0]).replace('$', ''));
            return Number.isFinite(n) ? n : 0;
        }
        if (type === 'date') {
            const t = Date.parse(text);
            return Number.isFinite(t) ? t : 0;
        }
        return text.toLowerCase();
    }

    function headerLabel(th) {
        if (!th) return '';
        // Avoid cloneNode + querySelectorAll on every prepare pass (hot path).
        let text = '';
        const kids = th.childNodes;
        for (let i = 0; i < kids.length; i += 1) {
            const node = kids[i];
            if (node.nodeType === 3) {
                text += node.textContent || '';
                continue;
            }
            if (node.nodeType !== 1) continue;
            const el = node;
            const tag = el.tagName;
            if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'LABEL') continue;
            if (el.classList && (el.classList.contains('admin-sort-caret') || el.classList.contains('sr-only'))) {
                continue;
            }
            text += el.textContent || '';
        }
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function slugify(label, used) {
        let base = String(label || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        if (!base) base = 'col';
        let key = base;
        let n = 2;
        while (used[key]) {
            key = base + '-' + n;
            n += 1;
        }
        used[key] = true;
        return key;
    }

    function looksNumeric(text) {
        const t = String(text || '').replace(/\s+/g, '').replace(/,/g, '');
        return /^-?\$?[0-9]+(?:\.[0-9]+)?%?$/.test(t);
    }

    function looksDate(text) {
        const t = String(text || '').trim();
        if (!t || t === '—' || t === '-') return false;
        if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t) && !/^\d{4}-\d{2}-\d{2}/.test(t) && !/[A-Za-z]{3,}/.test(t)) {
            return false;
        }
        const parsed = Date.parse(t);
        return Number.isFinite(parsed);
    }

    function inferType(table, colIndex) {
        const tbody = table.tBodies[0];
        if (!tbody) return 'text';
        const samples = [];
        const limit = Math.min(tbody.rows.length, 24);
        for (let i = 0; i < limit; i += 1) {
            const td = tbody.rows[i].cells[colIndex];
            if (!td) continue;
            if (td.hasAttribute('colspan')) continue;
            const raw = td.getAttribute('data-sort-value');
            const text = raw != null && raw !== '' ? String(raw) : String(td.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text || text === '—' || text === '-' || text === 'N/A') continue;
            samples.push(text);
        }
        if (!samples.length) return 'text';
        if (samples.every(looksNumeric)) return 'number';
        if (samples.every(looksDate)) return 'date';
        return 'text';
    }

    function isUnsortableTh(th) {
        if (!th) return true;
        if (th.hasAttribute('data-no-sort')) return true;
        if (th.querySelector('input, button, select')) return true;
        if (th.classList.contains('col-select') || th.classList.contains('col-actions')) return true;
        const label = headerLabel(th);
        if (!label) return true;
        if (/^(actions?|edit|view)$/i.test(label)) return true;
        return false;
    }

    function isEditorTable(table) {
        if (!table) return true;
        if (table._adminSortIsEditor != null) return table._adminSortIsEditor;
        if (table.hasAttribute('data-no-sort')) {
            table._adminSortIsEditor = true;
            return true;
        }
        if (table.id && EDITOR_TABLE_IDS[table.id]) {
            table._adminSortIsEditor = true;
            return true;
        }
        if (table.classList.contains('hm-variant-table')) {
            table._adminSortIsEditor = true;
            return true;
        }
        const tbody = table.tBodies[0];
        if (!tbody || !tbody.rows.length) return false;
        // Sample first rows only — full querySelectorAll on large product tables
        // was part of the main-thread cost during MutationObserver rescans.
        let cells = 0;
        let inputs = 0;
        const limit = Math.min(tbody.rows.length, 8);
        for (let i = 0; i < limit; i += 1) {
            const row = tbody.rows[i];
            for (let c = 0; c < row.cells.length; c += 1) {
                cells += 1;
                if (row.cells[c].querySelector('input, textarea, select')) inputs += 1;
            }
        }
        if (!cells) return false;
        const isEditor = inputs / cells > 0.4;
        if (tbody.rows.length >= 8 || isEditor) table._adminSortIsEditor = isEditor;
        return isEditor;
    }

    function tbodySignature(table) {
        const tbody = table && table.tBodies && table.tBodies[0];
        if (!tbody) return '0';
        const rows = tbody.rows;
        const n = rows.length;
        if (!n) return '0';
        const first = rows[0];
        const last = rows[n - 1];
        const mid = rows[n >> 1];
        function cellSig(row) {
            if (!row || !row.cells[0]) return '';
            const td = row.cells[0];
            const raw = td.getAttribute('data-sort-value');
            if (raw != null && raw !== '') return String(raw).slice(0, 32);
            return String(td.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
        }
        return n + '|' + cellSig(first) + '|' + cellSig(mid) + '|' + cellSig(last);
    }

    function ensureCarets(thead) {
        thead.querySelectorAll('th[data-sort]').forEach((th) => {
            th.tabIndex = 0;
            th.setAttribute('role', 'columnheader');
            if (!th.hasAttribute('aria-sort')) th.setAttribute('aria-sort', 'none');
            const label = headerLabel(th);
            if (label && !th.getAttribute('title')) {
                th.setAttribute('title', 'Sort by ' + label);
            }
            if (!th.querySelector('.admin-sort-caret')) {
                const caret = document.createElement('span');
                caret.className = 'admin-sort-caret';
                caret.setAttribute('aria-hidden', 'true');
                th.appendChild(caret);
            }
        });
    }

    function updateIndicators(thead, activeKey, dir) {
        thead.querySelectorAll('th[data-sort]').forEach((th) => {
            th.classList.remove('is-sorted-asc', 'is-sorted-desc');
            const key = th.getAttribute('data-sort');
            if (key && key === activeKey) {
                th.classList.add(dir === 'asc' ? 'is-sorted-asc' : 'is-sorted-desc');
                th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
            } else {
                th.setAttribute('aria-sort', 'none');
            }
        });
    }

    function memoryKey(table) {
        const section = table.closest('[id]');
        const sid = section && section.id ? section.id : 'admin';
        const headers = Array.prototype.map
            .call(table.querySelectorAll('thead th'), (th) => headerLabel(th) || '_')
            .join('|');
        return sid + '::' + headers;
    }

    function clientSortRows(table, th, dir) {
        const tbody = table.tBodies[0];
        if (!tbody) return;
        const type = th.getAttribute('data-sort-type') || 'text';
        const colIndex = Array.prototype.indexOf.call(th.parentNode.children, th);
        if (colIndex < 0) return;
        const dataRows = [];
        const pinned = [];
        Array.prototype.forEach.call(tbody.rows, (row) => {
            const first = row.cells[0];
            if (first && first.hasAttribute('colspan') && row.cells.length === 1) {
                pinned.push(row);
                return;
            }
            dataRows.push(row);
        });
        const mult = dir === 'asc' ? 1 : -1;
        dataRows.sort((a, b) => {
            const va = parseCellValue(a.cells[colIndex], type);
            const vb = parseCellValue(b.cells[colIndex], type);
            if (va < vb) return -1 * mult;
            if (va > vb) return 1 * mult;
            return 0;
        });
        const desired = pinned.concat(dataRows);
        let inOrder = desired.length === tbody.rows.length;
        if (inOrder) {
            for (let i = 0; i < desired.length; i += 1) {
                if (tbody.rows[i] !== desired[i]) {
                    inOrder = false;
                    break;
                }
            }
        }
        if (inOrder) return;
        withSuppressedMutations(() => {
            const frag = document.createDocumentFragment();
            desired.forEach((r) => frag.appendChild(r));
            tbody.appendChild(frag);
        });
    }

    function prepareTable(table) {
        if (!table || String(table.tagName || '').toUpperCase() !== 'TABLE') return false;
        if (isEditorTable(table)) return false;
        const thead = table.tHead;
        if (!thead) return false;

        const used = {};
        thead.querySelectorAll('th[data-sort]').forEach((th) => {
            const key = th.getAttribute('data-sort');
            if (key) used[key] = true;
        });

        Array.prototype.forEach.call(thead.querySelectorAll('th'), (th, idx) => {
            if (isUnsortableTh(th)) return;
            if (!th.hasAttribute('data-sort')) {
                th.setAttribute('data-sort', slugify(headerLabel(th), used));
                th.setAttribute('data-sort-auto', '1');
            }
            const auto = th.getAttribute('data-sort-auto') === '1';
            if (auto || !th.getAttribute('data-sort-type')) {
                const type = inferType(table, idx);
                const prev = th.getAttribute('data-sort-type');
                if (!prev || (auto && prev === 'text' && type !== 'text')) {
                    th.setAttribute('data-sort-type', type);
                    if (!th.getAttribute('data-sort-default')) {
                        th.setAttribute('data-sort-default', type === 'text' ? 'asc' : 'desc');
                    }
                }
            }
        });

        withSuppressedMutations(() => ensureCarets(thead));
        if (!table._adminSortClickBound) {
            table._adminSortClickBound = true;
            table.addEventListener('click', onTableClick);
            table.addEventListener('keydown', onTableKeydown);
        }
        table._adminSortPrepared = true;
        return true;
    }

    function applyRememberedSort(table) {
        if (!table || table._adminSortMode === 'server') return;
        const mem = sortMemory.get(memoryKey(table));
        if (!mem || !mem.key) return;
        const thead = table.tHead;
        if (!thead) return;
        const th = thead.querySelector('th[data-sort="' + mem.key + '"]');
        if (!th) return;
        table._adminSortState = { key: mem.key, dir: mem.dir === 'desc' ? 'desc' : 'asc' };
        updateIndicators(thead, mem.key, table._adminSortState.dir);
        clientSortRows(table, th, table._adminSortState.dir);
    }

    function prepareTableFresh(table) {
        if (!prepareTable(table)) return;
        const sig = tbodySignature(table);
        if (table._adminSortBodySig === sig && table._adminSortPrepared) {
            // Same rows — only ensure indicators match memory; skip re-sort work.
            const mem = sortMemory.get(memoryKey(table));
            if (mem && mem.key && table.tHead) {
                updateIndicators(table.tHead, mem.key, mem.dir === 'desc' ? 'desc' : 'asc');
            }
            return;
        }
        table._adminSortBodySig = sig;
        applyRememberedSort(table);
        table._adminSortBodySig = tbodySignature(table);
    }

    function prepareAll(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const tables =
            scope.tagName && String(scope.tagName).toUpperCase() === 'TABLE'
                ? [scope]
                : Array.prototype.slice.call(scope.querySelectorAll('table'));
        tables.forEach((table) => prepareTableFresh(table));
    }

    function flushPendingTables() {
        scanTimer = null;
        if (suppressMutations) {
            // Our own writes still draining — try again shortly.
            scanTimer = setTimeout(flushPendingTables, 32);
            return;
        }
        const batch = Array.prototype.slice.call(pendingTables);
        pendingTables.clear();
        batch.forEach((table) => {
            if (!table || !table.isConnected) return;
            prepareTableFresh(table);
        });
    }

    function queuePrepareTables(tables) {
        if (tables && tables.length) {
            tables.forEach((t) => {
                if (t && t.nodeType === 1) pendingTables.add(t);
            });
        }
        if (scanTimer) return;
        scanTimer = setTimeout(flushPendingTables, 48);
    }

    function tableFromMutationTarget(target) {
        if (!target || target.nodeType !== 1) return null;
        const tag = target.tagName;
        if (tag === 'TABLE') return target;
        if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT' || tag === 'TR' || tag === 'TD' || tag === 'TH') {
            return target.closest ? target.closest('table') : null;
        }
        return null;
    }

    /**
     * @param {HTMLTableElement|string} tableOrEl
     * @param {{ mode?: 'client'|'server', key?: string|null, dir?: 'asc'|'desc', onSort?: function }} options
     */
    function bind(tableOrEl, options) {
        const opts = options || {};
        const table =
            typeof tableOrEl === 'string' ? document.querySelector(tableOrEl) : tableOrEl;
        if (!table || String(table.tagName || '').toUpperCase() !== 'TABLE') return null;

        prepareTable(table);

        const thead = table.tHead;
        if (!thead) return null;

        const mode = opts.mode === 'server' ? 'server' : 'client';
        const onSort = typeof opts.onSort === 'function' ? opts.onSort : null;
        table._adminSortMode = mode;
        table._adminSortOnSort = onSort;

        table._adminSortState = {
            key: opts.key || (table._adminSortState && table._adminSortState.key) || null,
            dir: opts.dir === 'desc' ? 'desc' : (table._adminSortState && table._adminSortState.dir) || 'asc',
        };

        if (table._adminSortState.key) {
            updateIndicators(thead, table._adminSortState.key, table._adminSortState.dir);
            sortMemory.set(memoryKey(table), {
                key: table._adminSortState.key,
                dir: table._adminSortState.dir,
            });
        }

        const api = {
            setState(key, dir) {
                table._adminSortState = {
                    key: key || null,
                    dir: dir === 'desc' ? 'desc' : 'asc',
                };
                if (key) {
                    updateIndicators(thead, key, table._adminSortState.dir);
                    sortMemory.set(memoryKey(table), {
                        key: table._adminSortState.key,
                        dir: table._adminSortState.dir,
                    });
                }
            },
            getState() {
                return Object.assign({}, table._adminSortState);
            },
        };
        table._adminSortApi = api;
        table._adminSortBound = true;
        return api;
    }

    function handleSortClick(th) {
        const table = th.closest('table');
        if (!table || isEditorTable(table)) return;
        const thead = table.tHead;
        if (!thead || !thead.contains(th)) return;

        const key = th.getAttribute('data-sort');
        if (!key) return;

        const state = table._adminSortState || { key: null, dir: 'asc' };
        if (state.key === key) {
            state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
            state.key = key;
            const type = th.getAttribute('data-sort-type') || 'text';
            const explicit = th.getAttribute('data-sort-default');
            state.dir = explicit === 'desc' || explicit === 'asc'
                ? explicit
                : type === 'text'
                  ? 'asc'
                  : 'desc';
        }
        table._adminSortState = state;
        sortMemory.set(memoryKey(table), { key: state.key, dir: state.dir });
        updateIndicators(thead, state.key, state.dir);

        if (table._adminSortMode === 'server' && typeof table._adminSortOnSort === 'function') {
            table._adminSortOnSort(state.key, state.dir);
            return;
        }
        clientSortRows(table, th, state.dir);
        table._adminSortBodySig = tbodySignature(table);
    }

    function onTableClick(e) {
        if (e.target.closest && e.target.closest('input, button, a, label, select')) return;
        const th = e.target.closest && e.target.closest('th[data-sort]');
        if (!th || !e.currentTarget.contains(th)) return;
        e.preventDefault();
        handleSortClick(th);
    }

    function onTableKeydown(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const th = e.target.closest && e.target.closest('th[data-sort]');
        if (!th || !e.currentTarget.contains(th)) return;
        e.preventDefault();
        handleSortClick(th);
    }

    function startObserver() {
        if (!global.document || typeof MutationObserver === 'undefined') return;
        if (document._adminSortObserver || observerStarted) return;
        observerStarted = true;
        const observer = new MutationObserver((mutations) => {
            if (suppressMutations) return;
            const found = [];
            for (let i = 0; i < mutations.length; i += 1) {
                const m = mutations[i];
                if (m.type !== 'childList') continue;
                const fromTarget = tableFromMutationTarget(m.target);
                if (fromTarget) found.push(fromTarget);
                const nodes = m.addedNodes;
                for (let n = 0; n < nodes.length; n += 1) {
                    const node = nodes[n];
                    if (!node || node.nodeType !== 1) continue;
                    const tag = node.tagName;
                    if (tag === 'TABLE') {
                        found.push(node);
                        continue;
                    }
                    if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TR') {
                        const t = tableFromMutationTarget(node);
                        if (t) found.push(t);
                        continue;
                    }
                    if (node.querySelector) {
                        const nested = node.querySelectorAll('table');
                        for (let k = 0; k < nested.length; k += 1) found.push(nested[k]);
                    }
                }
            }
            if (found.length) queuePrepareTables(found);
        });
        const root = document.body || document.documentElement;
        if (!root) return;
        observer.observe(root, { childList: true, subtree: true });
        document._adminSortObserver = observer;
    }

    function autoInit() {
        if (!global.document) return;
        startObserver();
        prepareAll(document);
    }

    if (global.document) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', autoInit);
        } else {
            autoInit();
        }
    }

    global.AdminTableSort = { bind, prepareTable, prepareAll };
})(typeof window !== 'undefined' ? window : globalThis);
