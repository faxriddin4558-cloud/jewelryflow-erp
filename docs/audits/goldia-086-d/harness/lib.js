// PHASE F3: synthetic organization D (GOLDIA AUDIT 086 D) on STAGING only. Same key guard as the staging harness
// (the session key must be the staging service key); D's own 0600 credentials file in the scratchpad.
process.env.GA_CREDS = process.env.GA_CREDS_D || '/tmp/claude-0/-home-user-jewelryflow-erp/831fb3b9-adcd-5c4c-b551-ff376e212168/scratchpad/stg086d/creds.json';
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const ORG_D = 'a5d17086-0000-4000-8000-202611130086';
const STATE = '/tmp/claude-0/-home-user-jewelryflow-erp/831fb3b9-adcd-5c4c-b551-ff376e212168/scratchpad/stg086d/state.json';
module.exports = { ...L, ORG: ORG_D, ORG_CODE: 'GOLDIA-AUDIT-086-D', ORG_D, STATE, ORG_A: L.ORG, ORG_B: L.ORG_B };
