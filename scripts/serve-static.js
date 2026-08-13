#!/usr/bin/env node
/**
 * Simple static file server for local storefront preview (port 8765).
 * Uses path.normalize so Windows backslashes pass the root safety check.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT) || 8765;
const root = path.resolve(__dirname, '..');

const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ico': 'image/x-icon',
};

function safeFilePath(urlPath) {
    let p = decodeURIComponent(String(urlPath || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const rel = p.replace(/^\/+/, '').replace(/\\/g, '/');
    const file = path.normalize(path.join(root, rel));
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (file !== root && !file.startsWith(rootWithSep)) return null;
    return file;
}

const server = http.createServer((req, res) => {
    const file = safeFilePath(req.url);
    if (!file) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
});

server.listen(port, () => {
    console.log(`Static server http://localhost:${port} (root: ${root})`);
});
