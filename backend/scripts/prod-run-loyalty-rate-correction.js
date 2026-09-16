'use strict';
/**
 * One-off: send today's loyalty_rate_correction batch (up to daily cap).
 * Safe to re-run — dedupes via loyalty_email_sends; only targets prior program_intro.
 */
const { createPool } = require('../utils/dbConfig');
const { ensureLoyaltyTiersSchema } = require('../utils/ensureLoyaltyTiersSchema');
const {
    runThrottledRateCorrectionSend,
    getRateCorrectionSendStats,
} = require('../services/loyaltyRateCorrectionEmailQueue');

(async () => {
    const pool = createPool({ connectionLimit: 3 });
    await ensureLoyaltyTiersSchema(pool);

    const before = await getRateCorrectionSendStats(pool);
    console.log('Before:', JSON.stringify(before));

    const result = await runThrottledRateCorrectionSend(pool, {
        trigger: 'prod_rate_correction_script',
    });
    console.log('Result:', JSON.stringify(result));

    const after = await getRateCorrectionSendStats(pool);
    console.log('After:', JSON.stringify(after));

    await pool.end();
    process.exit(0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
