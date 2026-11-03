// Real Supabase Auth (GoTrue) + PostgREST harness for the LOCAL disposable 075 stack (127.0.0.1:54321) only.
// Secrets come from the session environment; nothing secret is printed or written to the repo.
const fs = require('fs');
const KEYS = JSON.parse(require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '../../../releases/staging-075/harness/gateway.js'), 'keys']).toString());
const KEY = KEYS.service; const ANON = KEYS.anon;
const URL = process.env.GA_URL || 'http://127.0.0.1:54321';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(URL)) throw new Error('guard: local stack only');
const CREDS = process.env.GA_CREDS || '/tmp/claude-0/-home-user-jewelryflow-erp/831fb3b9-adcd-5c4c-b551-ff376e212168/scratchpad/local075/creds.json';
const ORG = 'a0750000-0000-4000-8000-000000000075'; // dedicated synthetic audit organization
const ORG_CODE = 'GOLDIA-AUDIT-075';
const ORG56 = '00000000-0000-0000-0000-000000000056'; // stand-in org holding the planted long code
const SVC = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
const creds = () => (fs.existsSync(CREDS) ? JSON.parse(fs.readFileSync(CREDS)) : {});
const tokens = {};
async function login(tag) {
  const c = creds()[tag]; if (!c) throw new Error('no creds for ' + tag);
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password }) });
  const j = await r.json(); if (!j.access_token) throw new Error(`login ${tag} failed ${r.status}`);
  const p = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString());
  if (p.role !== 'authenticated') throw new Error('unexpected token');
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
const tashkentToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
module.exports = { URL, KEY, ANON, ORG, ORG56, ORG_CODE, CREDS, creds, login, tokens, rpc, usel, uwrite, sel, svc, R, T, r4, eq, must, tashkentToday };
