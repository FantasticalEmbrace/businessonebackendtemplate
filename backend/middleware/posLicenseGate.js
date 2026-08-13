'use strict';

const { assertCanWritePos } = require('../services/posMerchantLicense');

async function requireActivePosLicense(req, res, next) {
    try {
        const check = await assertCanWritePos(req.pool);
        if (!check.ok) {
            return res.status(402).json({
                error: check.message,
                code: check.code || 'POS_LICENSE_REQUIRED',
                billingPortalUrl: check.license?.billingPortalUrl,
                license: check.license
                    ? {
                          status: check.license.status,
                          licensedStationCount: check.license.licensedStationCount,
                          monthlyFormatted: check.license.monthlyFormatted,
                          billingPortalUrl: check.license.billingPortalUrl,
                          inGracePeriod: check.license.inGracePeriod,
                          warningMessage: check.warningMessage || check.license.warningMessage
                      }
                    : undefined
            });
        }
        req.posLicense = check.license;
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = { requireActivePosLicense };
