/**
 * Shared MySQL connection config for server.js and backend scripts.
 * Supports local MySQL and Linode / Akamai Managed MySQL (SSL + CA cert).
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BACKEND_ROOT = path.join(__dirname, '..');
let envLoaded = false;

function loadBackendEnv(envPath) {
    const file = envPath || path.join(BACKEND_ROOT, '.env');
    if (!envLoaded || envPath) {
        require('dotenv').config({ path: file });
        if (!envPath) envLoaded = true;
    }
    return file;
}

/** Hostnames for managed MySQL (SSL required). */
function isManagedMysqlHost(host) {
    if (!host) return false;
    const h = String(host).toLowerCase();
    return h.includes('linodedb.net') || h.includes('ondigitalocean.com');
}

function shouldUseSsl() {
    const flag = process.env.DB_SSL;
    if (flag === 'true' || flag === '1') return true;
    if (flag === 'false' || flag === '0') return false;
    return isManagedMysqlHost(process.env.DB_HOST);
}

/**
 * Resolve CA path relative to backend/ when not absolute.
 * @returns {string|null}
 */
function resolveCaPath(caPath) {
    const raw = caPath || process.env.DB_SSL_CA_PATH || process.env.DB_SSL_CA;
    if (!raw || !String(raw).trim()) return null;
    const trimmed = String(raw).trim();
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.join(BACKEND_ROOT, trimmed);
    if (!fs.existsSync(resolved)) {
        throw new Error(`DB SSL CA certificate not found: ${resolved}`);
    }
    return resolved;
}

function buildSslOptions() {
    if (!shouldUseSsl()) return undefined;

    const ssl = { rejectUnauthorized: true };
    const caFile = resolveCaPath();
    if (caFile) {
        ssl.ca = fs.readFileSync(caFile);
        return ssl;
    }

    if (isManagedMysqlHost(process.env.DB_HOST)) {
        throw new Error(
            'Linode Managed MySQL requires DB_SSL_CA_PATH (download CA from Cloud Manager → Databases → Connection Details)'
        );
    }

    return ssl;
}

/**
 * @param {object} [overrides] — merged into pool config (e.g. connectionLimit)
 * @returns {import('mysql2/promise').PoolOptions}
 */
function buildDbConfig(overrides = {}) {
    loadBackendEnv();

    const config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        ...overrides
    };

    const ssl = buildSslOptions();
    if (ssl) config.ssl = ssl;

    return config;
}

function createPool(overrides = {}) {
    return mysql.createPool(buildDbConfig(overrides));
}

async function createConnection(overrides = {}) {
    const cfg = buildDbConfig(overrides);
    delete cfg.waitForConnections;
    delete cfg.connectionLimit;
    delete cfg.queueLimit;
    return mysql.createConnection(cfg);
}

module.exports = {
    BACKEND_ROOT,
    loadBackendEnv,
    isManagedMysqlHost,
    shouldUseSsl,
    resolveCaPath,
    buildDbConfig,
    createPool,
    createConnection
};
