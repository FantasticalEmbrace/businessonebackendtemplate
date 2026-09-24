/**
 * US state codes for storefront forms (checkout, account, address autocomplete).
 * Brand-neutral; exposed as window.STORE_US_STATE.
 */
(function (global) {
    'use strict';

    const STATE_OPTIONS = [
        ['AL', 'Alabama'],
        ['AK', 'Alaska'],
        ['AZ', 'Arizona'],
        ['AR', 'Arkansas'],
        ['CA', 'California'],
        ['CO', 'Colorado'],
        ['CT', 'Connecticut'],
        ['DE', 'Delaware'],
        ['DC', 'District of Columbia'],
        ['FL', 'Florida'],
        ['GA', 'Georgia'],
        ['HI', 'Hawaii'],
        ['ID', 'Idaho'],
        ['IL', 'Illinois'],
        ['IN', 'Indiana'],
        ['IA', 'Iowa'],
        ['KS', 'Kansas'],
        ['KY', 'Kentucky'],
        ['LA', 'Louisiana'],
        ['ME', 'Maine'],
        ['MD', 'Maryland'],
        ['MA', 'Massachusetts'],
        ['MI', 'Michigan'],
        ['MN', 'Minnesota'],
        ['MS', 'Mississippi'],
        ['MO', 'Missouri'],
        ['MT', 'Montana'],
        ['NE', 'Nebraska'],
        ['NV', 'Nevada'],
        ['NH', 'New Hampshire'],
        ['NJ', 'New Jersey'],
        ['NM', 'New Mexico'],
        ['NY', 'New York'],
        ['NC', 'North Carolina'],
        ['ND', 'North Dakota'],
        ['OH', 'Ohio'],
        ['OK', 'Oklahoma'],
        ['OR', 'Oregon'],
        ['PA', 'Pennsylvania'],
        ['RI', 'Rhode Island'],
        ['SC', 'South Carolina'],
        ['SD', 'South Dakota'],
        ['TN', 'Tennessee'],
        ['TX', 'Texas'],
        ['UT', 'Utah'],
        ['VT', 'Vermont'],
        ['VA', 'Virginia'],
        ['WA', 'Washington'],
        ['WV', 'West Virginia'],
        ['WI', 'Wisconsin'],
        ['WY', 'Wyoming'],
    ];

    const NAME_TO_CODE = Object.fromEntries(STATE_OPTIONS.map(([code, name]) => [name.toLowerCase(), code]));

    function normalizeUsStateCode(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
        return NAME_TO_CODE[s.toLowerCase()] || '';
    }

    function populateStateSelect(selectEl, { placeholder = 'Select state', selected = '' } = {}) {
        if (!selectEl || selectEl.tagName !== 'SELECT') return;
        const want = normalizeUsStateCode(selected);
        selectEl.innerHTML = '';
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = placeholder;
        selectEl.appendChild(blank);
        for (const [code, name] of STATE_OPTIONS) {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = name;
            if (code === want) opt.selected = true;
            selectEl.appendChild(opt);
        }
        if (want) selectEl.value = want;
    }

    function setStateFieldValue(fieldEl, rawState) {
        if (!fieldEl) return;
        const code = normalizeUsStateCode(rawState);
        if (fieldEl.tagName === 'SELECT') {
            if (code && !fieldEl.querySelector(`option[value="${code}"]`)) {
                const opt = document.createElement('option');
                opt.value = code;
                opt.textContent = code;
                fieldEl.appendChild(opt);
            }
            fieldEl.value = code || '';
            return;
        }
        fieldEl.value = code || String(rawState || '').trim();
    }

    global.STORE_US_STATE = {
        STATE_OPTIONS,
        normalizeUsStateCode,
        populateStateSelect,
        setStateFieldValue,
    };
})(typeof window !== 'undefined' ? window : globalThis);
