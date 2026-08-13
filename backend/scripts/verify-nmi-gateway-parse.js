#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { parseNmiBody } = require('../services/nmiGateway');

const raw = 'response=1&responsetext=Approved&transactionid=42';
const p = parseNmiBody(raw);
assert.strictEqual(p.response, '1');
assert.strictEqual(p.transactionid, '42');
console.log('parseNmiBody: OK');
