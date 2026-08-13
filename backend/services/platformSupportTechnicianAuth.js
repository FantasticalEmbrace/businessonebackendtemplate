'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function parseTechnicianUsers() {
    const raw = String(process.env.PLATFORM_SUPPORT_TECH_USERS || '').trim();
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((u) => ({
                        email: String(u.email || '').trim().toLowerCase(),
                        password: String(u.password || ''),
                        name: String(u.name || u.email || 'Technician').trim()
                    }))
                    .filter((u) => u.email && u.password);
            }
        } catch {
            /* fall through */
        }
    }
    const email = String(process.env.PLATFORM_SUPPORT_TECH_EMAIL || '').trim().toLowerCase();
    const password = String(process.env.PLATFORM_SUPPORT_TECH_PASSWORD || '');
    if (email && password) {
        return [
            {
                email,
                password,
                name: String(process.env.PLATFORM_SUPPORT_TECH_NAME || 'Support technician').trim()
            }
        ];
    }
    return [];
}

function verifyTechnicianCredentials(email, password) {
    const normalized = String(email || '').trim().toLowerCase();
    const pass = String(password || '');
    if (!normalized || !pass) return null;
    const users = parseTechnicianUsers();
    for (const user of users) {
        if (user.email !== normalized) continue;
        const a = Buffer.from(user.password);
        const b = Buffer.from(pass);
        if (a.length !== b.length) continue;
        if (crypto.timingSafeEqual(a, b)) {
            return { email: user.email, name: user.name };
        }
    }
    return null;
}

function signTechnicianToken(technician) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        const err = new Error('Server configuration error');
        err.code = 'NO_JWT_SECRET';
        throw err;
    }
    return jwt.sign(
        {
            type: 'support_technician',
            email: technician.email,
            name: technician.name
        },
        secret,
        { expiresIn: '14d' }
    );
}

function verifyTechnicianToken(token) {
    const secret = process.env.JWT_SECRET;
    if (!secret || !token) return null;
    try {
        const decoded = jwt.verify(token, secret);
        if (decoded?.type !== 'support_technician' || !decoded.email) return null;
        return {
            email: decoded.email,
            name: decoded.name || decoded.email,
            role: 'support_technician'
        };
    } catch {
        return null;
    }
}

function isTechnicianAuthConfigured() {
    return parseTechnicianUsers().length > 0;
}

function parseGoogleAllowedEmails() {
    const raw = String(process.env.PLATFORM_SUPPORT_GOOGLE_EMAILS || '').trim();
    if (raw) {
        return raw
            .split(/[,;\s]+/)
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean);
    }
    return parseTechnicianUsers()
        .map((u) => u.email)
        .filter(Boolean);
}

function isGoogleTechnicianAuthConfigured() {
    return parseGoogleAllowedEmails().length > 0;
}

function authorizeGoogleTechnician(profile) {
    const email = String(profile?.email || '')
        .trim()
        .toLowerCase();
    if (!email) return null;
    const allowed = parseGoogleAllowedEmails();
    if (!allowed.includes(email)) return null;
    const users = parseTechnicianUsers();
    const match = users.find((u) => u.email === email);
    const name =
        match?.name ||
        [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
        email;
    return { email, name };
}

module.exports = {
    parseTechnicianUsers,
    verifyTechnicianCredentials,
    signTechnicianToken,
    verifyTechnicianToken,
    isTechnicianAuthConfigured,
    parseGoogleAllowedEmails,
    isGoogleTechnicianAuthConfigured,
    authorizeGoogleTechnician
};
