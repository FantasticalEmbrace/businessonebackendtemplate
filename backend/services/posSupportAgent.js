'use strict';

const crypto = require('crypto');
const {
    encryptSupportSecret,
    decryptSupportSecret,
    hashAgentKey,
    generateAgentApiKey,
    keyPrefix
} = require('../utils/posSupportCrypto');

const ONLINE_WINDOW_SEC = Math.max(30, Number(process.env.POS_SUPPORT_ONLINE_SECONDS) || 120);

function getEnrollKey() {
    return String(process.env.POS_SUPPORT_ENROLL_KEY || '').trim();
}

function isEnrollConfigured() {
    return Boolean(getEnrollKey());
}

function rustDeskServerConfig() {
    return {
        idServer: String(process.env.RUSTDESK_ID_SERVER || '').trim(),
        relayServer: String(process.env.RUSTDESK_RELAY_SERVER || '').trim(),
        apiServer: String(process.env.RUSTDESK_API_SERVER || '').trim(),
        webClientUrl: String(process.env.RUSTDESK_WEB_CLIENT_URL || '').trim().replace(/\/+$/, ''),
        configString: String(process.env.RUSTDESK_CONFIG_STRING || '').trim()
    };
}

function assertEnrollKey(provided) {
    const expected = getEnrollKey();
    if (!expected) {
        const err = new Error('POS support enrollment is not configured on the server.');
        err.code = 'SUPPORT_NOT_CONFIGURED';
        throw err;
    }
    const a = Buffer.from(String(provided || '').trim());
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        const err = new Error('Invalid support enrollment key');
        err.code = 'INVALID_ENROLL_KEY';
        throw err;
    }
}

function mapAgentRow(row, { includePassword = false } = {}) {
    if (!row) return null;
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at) : null;
    const online =
        lastSeen && Date.now() - lastSeen.getTime() <= ONLINE_WINDOW_SEC * 1000;
    const agent = {
        id: row.id,
        machineLabel: row.machine_label || '',
        hostname: row.hostname || '',
        platform: row.platform || '',
        osVersion: row.os_version || '',
        rustdeskId: row.rustdesk_id || '',
        registerLabel: row.register_label || '',
        notes: row.notes || '',
        isActive: Boolean(row.is_active),
        lastSeenAt: row.last_seen_at,
        lastRemoteAt: row.last_remote_at,
        online,
        keyPrefix: row.agent_key_prefix || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
    if (includePassword && row.rustdesk_password_enc) {
        agent.rustdeskPassword = decryptSupportSecret(row.rustdesk_password_enc);
    }
    return agent;
}

async function listSupportAgents(pool) {
    const [rows] = await pool.execute(
        `SELECT id, machine_label, hostname, platform, os_version, rustdesk_id,
                register_label, notes, is_active, last_seen_at, last_remote_at,
                agent_key_prefix, created_at, updated_at
         FROM pos_support_agents
         ORDER BY machine_label ASC, id ASC`
    );
    return (rows || []).map((row) => mapAgentRow(row));
}

async function findAgentByToken(pool, token) {
    const hash = hashAgentKey(token);
    const [rows] = await pool.execute(
        `SELECT * FROM pos_support_agents WHERE agent_key_hash = ? AND is_active = 1 LIMIT 1`,
        [hash]
    );
    return rows[0] || null;
}

async function registerSupportAgent(pool, body, { enrollKey }) {
    assertEnrollKey(enrollKey);

    const machineLabel = String(body.machineLabel || body.machine_label || body.hostname || 'Register PC')
        .trim()
        .slice(0, 128);
    if (machineLabel.length < 2) {
        const err = new Error('machine_label required');
        err.code = 'INVALID_LABEL';
        throw err;
    }

    const rustdeskId = String(body.rustdeskId || body.rustdesk_id || '').trim().slice(0, 32);
    if (!rustdeskId) {
        const err = new Error('rustdesk_id required — install RustDesk on this PC first.');
        err.code = 'RUSTDESK_ID_REQUIRED';
        throw err;
    }

    const apiKey = generateAgentApiKey();
    const apiKeyHash = hashAgentKey(apiKey);
    const prefix = keyPrefix(apiKey);
    const passwordPlain = String(body.rustdeskPassword || body.rustdesk_password || '').trim();
    const passwordEnc = passwordPlain ? encryptSupportSecret(passwordPlain) : null;

    const [result] = await pool.execute(
        `INSERT INTO pos_support_agents
         (agent_key_hash, agent_key_prefix, machine_label, hostname, platform, os_version,
          rustdesk_id, rustdesk_password_enc, register_label, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
            apiKeyHash,
            prefix,
            machineLabel,
            String(body.hostname || '').trim().slice(0, 128) || null,
            String(body.platform || 'windows').trim().slice(0, 32) || null,
            String(body.osVersion || body.os_version || '').trim().slice(0, 128) || null,
            rustdeskId,
            passwordEnc,
            String(body.registerLabel || body.register_label || '').trim().slice(0, 64) || null
        ]
    );

    return {
        agentId: result.insertId,
        agentKey: apiKey,
        keyPrefix: prefix,
        rustdeskId
    };
}

async function agentHeartbeat(pool, agentRow, body) {
    const rustdeskId = String(body.rustdeskId || body.rustdesk_id || agentRow.rustdesk_id || '')
        .trim()
        .slice(0, 32);
    const passwordPlain = String(body.rustdeskPassword || body.rustdesk_password || '').trim();
    const passwordEnc = passwordPlain ? encryptSupportSecret(passwordPlain) : agentRow.rustdesk_password_enc;

    await pool.execute(
        `UPDATE pos_support_agents SET
            rustdesk_id = COALESCE(?, rustdesk_id),
            rustdesk_password_enc = COALESCE(?, rustdesk_password_enc),
            hostname = COALESCE(?, hostname),
            os_version = COALESCE(?, os_version),
            register_label = COALESCE(?, register_label),
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            rustdeskId || null,
            passwordEnc,
            String(body.hostname || '').trim().slice(0, 128) || null,
            String(body.osVersion || body.os_version || '').trim().slice(0, 128) || null,
            String(body.registerLabel || body.register_label || '').trim().slice(0, 64) || null,
            agentRow.id
        ]
    );

    return mapAgentRow(
        {
            ...agentRow,
            rustdesk_id: rustdeskId || agentRow.rustdesk_id,
            last_seen_at: new Date()
        }
    );
}

function buildConnectLinks(agent, servers) {
    const id = String(agent.rustdeskId || '').trim();
    const password = String(agent.rustdeskPassword || '').trim();
    const links = {
        rustdeskId: id,
        password: password || null,
        copyId: id,
        instructions:
            'Open RustDesk on your support PC, enter the Remote ID, then use the password when prompted. The customer PC must stay on and online.'
    };

    if (id) {
        links.rustdeskUri = `rustdesk://${id}`;
        if (password) {
            links.rustdeskUriWithPassword = `rustdesk://${id}?password=${encodeURIComponent(password)}`;
        }
    }

    if (servers.webClientUrl && id) {
        const base = servers.webClientUrl;
        links.webClientUrl = password
            ? `${base}/#/${id}?password=${encodeURIComponent(password)}`
            : `${base}/#/${id}`;
    }

    return links;
}

async function beginRemoteSession(pool, agentId, adminUserId) {
    const [rows] = await pool.execute(`SELECT * FROM pos_support_agents WHERE id = ? LIMIT 1`, [
        Number(agentId)
    ]);
    const row = rows[0];
    if (!row || !row.is_active) {
        const err = new Error('Support agent not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (!row.rustdesk_id) {
        const err = new Error('This PC has no RustDesk ID yet.');
        err.code = 'NO_RUSTDESK_ID';
        throw err;
    }

    await pool.execute(
        `INSERT INTO pos_support_sessions (agent_id, admin_user_id) VALUES (?, ?)`,
        [row.id, adminUserId]
    );
    await pool.execute(
        `UPDATE pos_support_agents SET last_remote_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [row.id]
    );

    const agent = mapAgentRow(row, { includePassword: true });
    const servers = rustDeskServerConfig();
    return {
        agent,
        connect: buildConnectLinks(agent, servers),
        servers
    };
}

async function revokeSupportAgent(pool, agentId) {
    const [result] = await pool.execute(
        `UPDATE pos_support_agents SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [Number(agentId)]
    );
    return result.affectedRows > 0;
}

module.exports = {
    isEnrollConfigured,
    rustDeskServerConfig,
    listSupportAgents,
    findAgentByToken,
    registerSupportAgent,
    agentHeartbeat,
    beginRemoteSession,
    revokeSupportAgent,
    mapAgentRow
};
