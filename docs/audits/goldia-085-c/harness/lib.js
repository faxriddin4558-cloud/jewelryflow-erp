// PHASE D: synthetic organization C (GOLDIA AUDIT 085 C) on STAGING only. Wraps the staging harness library (same key
// guard: the session key must be the staging service key) with C's organization id and C's own 0600 credentials file.
const path = require('path');
process.env.GA_CREDS = process.env.GA_CREDS_C || '/tmp/claude-0/-home-user-jewelryflow-erp/831fb3b9-adcd-5c4c-b551-ff376e212168/scratchpad/stg085c/creds.json';
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const ORG_C = 'a5d17085-0000-4000-8000-202611110085';
module.exports = { ...L, ORG: ORG_C, ORG_CODE: 'GOLDIA-AUDIT-085-C', ORG_C, ORG_A: L.ORG, ORG_B: L.ORG_B };
