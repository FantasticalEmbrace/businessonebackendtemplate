'use strict';

const net = require('net');

const COPY_LABELS = ['', 'CUSTOMER COPY', 'STORE COPY', 'EXTRA COPY'];

function escposInit() {
    return Buffer.from([0x1b, 0x40]);
}

function escposPartialCut() {
    return Buffer.from([0x1d, 0x56, 0x42, 0x00]);
}

function escposDrawerKick() {
    return Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
}

function sanitizeLine(line) {
    return String(line || '')
        .replace(/\r/g, '')
        .replace(/[^\x09\x0a\x20-\x7e]/g, '?');
}

function encodeReceipt(lines) {
    const chunks = [escposInit()];
    for (const line of lines) {
        chunks.push(Buffer.from(`${sanitizeLine(line)}\n`, 'ascii'));
    }
    chunks.push(Buffer.from('\n', 'ascii'));
    chunks.push(escposPartialCut());
    return Buffer.concat(chunks);
}

function sendRaw(host, port, buffer, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => {
            socket.write(buffer, (err) => {
                if (err) {
                    socket.destroy();
                    reject(err);
                    return;
                }
                socket.end();
            });
        });
        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('Receipt printer connection timed out'));
        });
        socket.on('error', (err) => {
            reject(new Error(err.message || 'Could not reach receipt printer'));
        });
        socket.on('close', (hadError) => {
            if (hadError) return;
            resolve();
        });
    });
}

async function printEscposReceipt({ host, port, lines, copyCount = 1, openDrawer = false }) {
    const address = String(host || '').trim();
    if (!address) {
        throw new Error('Receipt printer network address is not configured for this register');
    }
    const portNum = Number(port) || 9100;
    const copies = Math.min(3, Math.max(1, Number(copyCount) || 1));
    const baseLines = Array.isArray(lines) ? lines.map(sanitizeLine).filter((line) => line !== '') : [];

    if (openDrawer) {
        await sendRaw(address, portNum, Buffer.concat([escposInit(), escposDrawerKick()]));
    }

    if (!baseLines.length) {
        return { ok: true, copies: 0, drawer: openDrawer };
    }

    for (let i = 0; i < copies; i += 1) {
        const copyLines = [...baseLines];
        if (copies > 1 && COPY_LABELS[i + 1]) {
            copyLines.unshift('--------------------------------', COPY_LABELS[i + 1]);
        }
        await sendRaw(address, portNum, encodeReceipt(copyLines));
    }

    return { ok: true, copies, drawer: openDrawer };
}

module.exports = {
    printEscposReceipt
};
