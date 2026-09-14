'use strict';

/** Shared NMI Collect.js styling for Business One signup / billing pages */
window.BusinessOneCollect = {
    getFieldCss() {
        return {
            border: 'none',
            'border-width': '0',
            'border-style': 'none',
            'border-radius': '0',
            outline: 'none',
            'box-shadow': 'none',
            margin: '0',
            padding: '12px 14px',
            'font-size': '16px',
            'line-height': '24px',
            height: '48px',
            width: '100%',
            'background-color': 'transparent',
            color: '#333333',
            'font-family': 'Helvetica, Arial, sans-serif'
        };
    },

    buildConfigureOptions({ fields, callback, paymentSelector = '#billing-submit' }) {
        const fieldCss = this.getFieldCss();
        return {
            paymentSelector,
            variant: 'inline',
            styleSniffer: false,
            customCss: fieldCss,
            focusCss: { ...fieldCss, outline: 'none', 'box-shadow': 'none' },
            invalidCss: { color: '#b91c1c' },
            fields,
            callback
        };
    }
};
