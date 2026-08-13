#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getProchargeLoginCreds, getProchargeApplicationKey, getProchargeMerchantNumber, getProchargeApiHost } = require('../utils/prochargeEnv');
const { getAuthToken, tokenizeCard, chargeToken } = require('../services/prochargeClient');

async function main() {
  const creds = getProchargeLoginCreds();
  console.log('host', getProchargeApiHost());
  console.log('merchant', getProchargeMerchantNumber());
  console.log('email', creds.email ? 'set' : 'missing');
  console.log('pin_len', (creds.pin || '').length);
  console.log('app_key_len', getProchargeApplicationKey().length);

  try {
    const token = await getAuthToken();
    console.log('AUTH_OK', token ? 'yes' : 'no');
  } catch (e) {
    console.log('AUTH_FAIL', e.message || e.responseText || e);
    process.exit(2);
  }

  const tok = await tokenizeCard({
    cardNumber: '4761120010000492',
    ccExpMonth: '12',
    ccExpYear: '28',
    cvv: '123',
    name: 'Test Payment',
    postalCode: '30742',
    street1: '1140 Battlefield Pkwy',
    email: creds.email
  });
  console.log('TOKENIZE', tok.ok ? 'OK' : 'FAIL', tok.responseText || tok.token?.slice(0, 12));

  if (!tok.ok) process.exit(3);

  const charge = await chargeToken({
    amount: '0.01',
    token: tok.token,
    orderNumber: String(Date.now()).slice(-8),
    email: creds.email,
    name: 'Test Payment',
    postalCode: '30742',
    street1: '1140 Battlefield Pkwy',
    city: 'Fort Oglethorpe',
    state: 'GA',
    description: 'HM Herbs / Business One billing connectivity test'
  });
  console.log('CHARGE', charge.ok ? 'OK' : 'FAIL', charge.responseCode, charge.responseText, charge.transactionId || '');
  const reachedProcessor =
    charge.ok ||
    String(charge.responseText || '')
      .toLowerCase()
      .includes('declined');
  if (!reachedProcessor) process.exit(4);
  console.log('PROCESSOR_REACHED yes');
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e.message || e);
  process.exit(1);
});
