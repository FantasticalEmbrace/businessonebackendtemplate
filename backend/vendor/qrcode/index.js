'use strict';

const QRCode = require('./lib/core/qrcode');
const svg = require('./lib/renderer/svg-tag');

function otpauthQrSvg(text) {
    const data = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
    const markup = svg.render(data, {
        margin: 2,
        width: 220,
        color: { dark: '#111827', light: '#ffffff' }
    });
    const trimmed = String(markup || '').trim();
    if (!trimmed.startsWith('<svg') || /<script/i.test(trimmed)) {
        throw new Error('QR markup was not an SVG image');
    }
    return trimmed;
}

module.exports = { otpauthQrSvg };
