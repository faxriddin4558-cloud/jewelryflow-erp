// Real Supabase Auth + PostgREST harness for Goldia STAGING only (ref vouehtlmsunebracahon), 075 audit.
// Secrets come from the session environment; nothing secret is printed or written to the repo.
const fs = require('fs');
const STAGING_REF = 'vouehtlmsunebracahon';
const KEY = process.env.GOLDIA_STAGING_SERVICE_ROLE_KEY || '';
const payload = (() => { try { return JSON.parse(Buffer.from(KEY.split('.')[1], 'base64url').toString()); } catch { return {}; } })();
if (payload.ref !== STAGING_REF || payload.role !== 'service_role') throw new Error('guard: key is not the staging service key — refusing');
const URL = `https://${STAGING_REF}.supabase.co`;
const CREDS = process.env.GA_CREDS || '/tmp/claude-0/-home-user-jewelryflow-erp/831fb3b9-adcd-5c4c-b551-ff376e212168/scratchpad/stg075/creds.json';
const ORG = 'a5d17075-0000-4000-8000-202611030075'; // synthetic audit organization A (main)
const ORG_CODE = 'GOLDIA-AUDIT-075-A';
const ORG_B = 'a5d17075-0000-4000-8000-20261103075b'; // synthetic audit organization B (other tenant)
const ORG_B_CODE = 'GOLDIA-AUDIT-075-B';
const AUDIT_ORGS = [ORG, ORG_B];
const SVC = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
const creds = () => (fs.existsSync(CREDS) ? JSON.parse(fs.readFileSync(CREDS)) : {});
const tokens = {};
async function login(tag) {
  const c = creds()[tag]; if (!c) throw new Error('no creds for ' + tag);
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password }) });
  const j = await r.json(); if (!j.access_token) throw new Error(`login ${tag} failed ${r.status}`);
  const p = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString());
  if (p.role !== 'authenticated' || p.ref && p.ref !== STAGING_REF) throw new Error('unexpected token');
  tokens[tag] = j.access_token; return j;
}
// user request: Authorization carries the user's real GoTrue JWT (PostgREST role = authenticated, RLS applies)
const UH = (tag) => ({ apikey: KEY, Authorization: `Bearer ${tokens[tag]}`, 'content-type': 'application/json' });
async function parse(r) { const t = await r.text(); let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; } return r.ok ? { ok: true, status: r.status, data: j } : { ok: false, status: r.status, error: (j && (j.message || j.msg || j.error_description)) || String(t).slice(0, 200), code: j && j.code }; }
async function rpc(tag, name, args = {}) { if (!tokens[tag]) await login(tag); return parse(await fetch(`${URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: UH(tag), body: JSON.stringify(args) })); }
async function usel(tag, path) { if (!tokens[tag]) await login(tag); return parse(await fetch(`${URL}/rest/v1/${path}`, { headers: UH(tag) })); }
async function uwrite(tag, method, path, body) { if (!tokens[tag]) await login(tag); return parse(await fetch(`${URL}/rest/v1/${path}`, { method, headers: { ...UH(tag), Prefer: 'return=representation' }, body: body && JSON.stringify(body) })); }
// service-role reads (the independent "ground truth"); always org-scoped by the caller
async function sel(path) { const r = await parse(await fetch(`${URL}/rest/v1/${path}`, { headers: SVC })); if (!r.ok) throw new Error(`sel ${path}: ${r.error}`); return r.data; }
async function svc(method, path, body, extra = {}) { return parse(await fetch(`${URL}/${path}`, { method, headers: { ...SVC, ...extra }, body: body && JSON.stringify(body) })); }
const R = []; const r4 = (x) => Math.round(Number(x) * 10000) / 10000;
const eq = (a, b, tol = 0.0005) => a !== null && a !== undefined && Math.abs(r4(a) - r4(b)) <= tol;
function T(id, title, ok, exp, act) { R.push({ id, title, ok: !!ok, expected: exp, actual: act, at: new Date().toISOString() }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | exp=' + JSON.stringify(exp) + ' act=' + JSON.stringify(act).slice(0, 220)); return !!ok; }
const must = (r, n) => { if (!r.ok) console.log('ERROR', n, r.status, r.error); return r.ok ? r.data : null; };
const OPS = [];
// every write: id of the created record, expected vs actual, kept in evidence
function op(entry) { OPS.push({ at: new Date().toISOString(), ...entry }); return entry; }
const tashkentToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
module.exports = { OPS, op, URL, KEY, ORG, ORG_CODE, ORG_B, ORG_B_CODE, AUDIT_ORGS, CREDS, creds, login, tokens, rpc, usel, uwrite, sel, svc, R, T, r4, eq, must, tashkentToday };
