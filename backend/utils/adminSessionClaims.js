'use strict';

/** Full admin session JWTs have adminId and no purpose. Step-up tokens must not pass. */
function isFullAdminSession(decoded) {
    const id = Number(decoded && decoded.adminId);
    if (!Number.isInteger(id) || id <= 0) return false;
    if (decoded.purpose) return false;
    return true;
}

module.exports = { isFullAdminSession };
