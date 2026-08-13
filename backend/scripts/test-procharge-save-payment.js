require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { savePaymentMethod } = require('../services/platformBillingAccount');
const { createPool } = require('../utils/dbConfig');

(async () => {
  const pool = createPool({ connectionLimit: 2 });
  try {
    const [rows] = await pool.execute('SELECT id FROM billing_accounts WHERE account_key = ? LIMIT 1', ['default']);
    const accountId = rows[0]?.id || 1;
    console.log('accountId', accountId);
    const saved = await savePaymentMethod(pool, accountId, {
      paymentMethodType: 'card',
      paymentToken: 'smoke-test-token-not-real',
      cardholderName: 'Smoke Test',
      billingEmail: 'test@example.com',
      businessName: 'HM Herbs Test'
    });
    console.log('SAVE_OK', JSON.stringify(saved));
  } catch (e) {
    console.log('SAVE_FAIL', e.code || '', e.message || String(e));
  } finally {
    await pool.end();
  }
})();
