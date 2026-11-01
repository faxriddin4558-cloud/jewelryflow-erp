// Minimal Supabase-compatible gateway for LOCAL ACCEPTANCE TESTING ONLY.
// - /auth/v1: password grant against auth.users (bcrypt), HS256 JWTs signed with a local random secret
// - /rest/v1: PostgREST-subset; every request runs in its own transaction as role anon/authenticated/service_role with request.jwt.claims set
// Binds 127.0.0.1 only and connects only to the unix-socket cluster in /opt/goldia-audit/pg.
const http = require('http'); const crypto = require('crypto'); const { Pool } = require('pg');
const SECRET = process.env.SHIM_JWT_SECRET; if (!SECRET) throw new Error('SHIM_JWT_SECRET required');
const pool = new Pool({ host: '/opt/goldia-audit/pg', port: 55432, user: 'postgres', database: 'postgres', max: 30 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (p) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), b = b64(p); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
function verify(t) { const [h, b, s] = (t || '').split('.'); if (!s) return null; const exp = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url'); if (exp !== s) return { invalid: true }; const p = JSON.parse(Buffer.from(b, 'base64url')); if (p.exp && p.exp < Date.now() / 1000) return { expired: true }; return p; }
const TTL = Number(process.env.SHIM_JWT_TTL || 3600);
const log = []; const reqLog = (e) => { log.push(e); if (process.env.SHIM_VERBOSE) console.log(JSON.stringify(e)); };
let meta = null;
async function loadMeta() {
  const cols = await pool.query(`select table_name t, column_name c from information_schema.columns where table_schema='public'`);
  const fks = await pool.query(`select c.conrelid::regclass::text src, a.attname col, c.confrelid::regclass::text dst, af.attname dcol from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] join pg_attribute af on af.attrelid=c.confrelid and af.attnum=c.confkey[1] where c.contype='f' and array_length(c.conkey,1)=1 and c.connamespace='public'::regnamespace`);
  const fns = await pool.query(`select p.proname, p.proargnames, p.proargtypes::regtype[]::text[] types, p.pronargs, p.pronargdefaults, p.proretset, p.prorettype::regtype::text rt, t.typtype from pg_proc p join pg_type t on t.oid=p.prorettype where p.pronamespace='public'::regnamespace`);
  meta = { cols: {}, fks: fks.rows, fns: {} };
  for (const r of cols.rows) (meta.cols[r.t] ||= new Set()).add(r.c);
  for (const f of fns.rows) (meta.fns[f.proname] ||= []).push(f);
}
const qi = (s) => { if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw Object.assign(new Error('bad identifier ' + s), { status: 400 }); return '"' + s + '"'; };
function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map(x => x.trim()); }
function buildSelect(table, sel, alias) {
  const parts = splitTop(sel || '*'); const out = [];
  for (const p of parts) {
    const m = p.match(/^(?:([a-zA-Z_0-9]+):)?([a-zA-Z_0-9]+)(?:!([a-zA-Z_0-9]+))?\((.*)\)$/s);
    if (m) {
      const [, al, target, , inner] = m; let fk, dst, dcol;
      if (meta.cols[table]?.has(target)) { fk = meta.fks.find(f => f.src === table && f.col === target); }
      else { fk = meta.fks.find(f => f.src === table && f.dst === target); }
      if (fk) { dst = fk.dst; dcol = fk.dcol; const sub = `(select row_to_json(_x) from (select ${buildSelect(dst, inner, 'e_' + dst)} from public.${qi(dst)} e_${dst} where e_${dst}.${qi(dcol)} = ${alias}.${qi(fk.col)} limit 1) _x)`; out.push(`${sub} as ${qi(al || target)}`); continue; }
      const rev = meta.fks.find(f => f.dst === table && f.src === target);
      if (rev) { out.push(`coalesce((select json_agg(row_to_json(_x)) from (select ${buildSelect(target, inner, 'r_' + target)} from public.${qi(target)} r_${target} where r_${target}.${qi(rev.col)} = ${alias}.${qi(rev.dcol)}) _x), '[]') as ${qi(al || target)}`); continue; }
      throw Object.assign(new Error(`Could not find a relationship between '${table}' and '${target}'`), { status: 400, code: 'PGRST200' });
    }
    if (p === '*') { out.push(`${alias}.*`); continue; }
    const m2 = p.match(/^(?:([a-zA-Z_0-9]+):)?([a-zA-Z_0-9]+)(?:::([a-z]+))?$/); if (!m2) throw Object.assign(new Error('bad select ' + p), { status: 400 });
    out.push(`${alias}.${qi(m2[2])}${m2[1] ? ' as ' + qi(m2[1]) : ''}`);
  }
  return out.join(', ');
}
function cond(col, expr, vals, alias = 't') {
  let neg = false; if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf('.'); const op = expr.slice(0, i); let v = expr.slice(i + 1); const c = `${alias}.${qi(col)}`; let s;
  const P = (x) => { vals.push(x); return `$${vals.length}`; };
  switch (op) {
    case 'eq': s = `${c} = ${P(v)}`; break; case 'neq': s = `${c} <> ${P(v)}`; break;
    case 'gt': s = `${c} > ${P(v)}`; break; case 'gte': s = `${c} >= ${P(v)}`; break;
    case 'lt': s = `${c} < ${P(v)}`; break; case 'lte': s = `${c} <= ${P(v)}`; break;
    case 'like': s = `${c}::text like ${P(v.replace(/\*/g, '%'))}`; break; case 'ilike': s = `${c}::text ilike ${P(v.replace(/\*/g, '%'))}`; break;
    case 'is': s = `${c} is ${v === 'null' ? 'null' : v === 'true' ? 'true' : v === 'false' ? 'false' : 'unknown'}`; break;
    case 'in': { const items = v.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')); s = `${c}::text = any(${P(items)}::text[])`; break; }
    default: throw Object.assign(new Error('unsupported operator ' + op), { status: 400 });
  }
  return neg ? `not (${s})` : s;
}
function orCond(expr, vals) { return '(' + splitTop(expr.replace(/^\(|\)$/g, '')).map(p => { const j = p.indexOf('.'); return cond(p.slice(0, j), p.slice(j + 1), vals); }).join(' or ') + ')'; }
async function withRole(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await c.query(`set local role ${claims.role === 'service_role' ? 'service_role' : claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
    const r = await fn(c); await c.query('commit'); return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
function send(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); }
function pgErr(res, e) { const status = e.status || (e.code === '42501' ? 403 : e.code === 'P0001' || e.code?.startsWith('22') || e.code?.startsWith('23') ? 400 : 400); send(res, status, { code: e.code || 'PGRST', message: e.message, details: e.detail || null, hint: e.hint || null }); }
const server = http.createServer((req, res) => {
  const origin = req.headers.origin; res.setHeader('Access-Control-Allow-Origin', origin || '*'); res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD'); res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  let body = ''; req.on('data', d => body += d); req.on('end', async () => {
    const url = new URL(req.url, 'http://127.0.0.1'); const t0 = Date.now(); let status = 200;
    try {
      if (!meta) await loadMeta();
      const authz = (req.headers.authorization || '').replace(/^Bearer /i, '') || req.headers.apikey;
      const claims = verify(authz);
      if (url.pathname.startsWith('/auth/v1/')) {
        const p = url.pathname.slice(9); const j = body ? JSON.parse(body) : {};
        const session = async (uid) => { const u = (await pool.query(`select id, email, raw_user_meta_data from auth.users where id=$1`, [uid])).rows[0]; const now = Math.floor(Date.now() / 1000);
          const user = { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data || {}, app_metadata: { provider: 'email' }, created_at: new Date().toISOString() };
          const access_token = sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, iat: now, exp: now + TTL, user_metadata: user.user_metadata });
          const refresh_token = crypto.randomBytes(16).toString('hex'); await pool.query(`insert into auth_shim_refresh(token, user_id) values ($1,$2)`, [refresh_token, u.id]);
          return { access_token, token_type: 'bearer', expires_in: TTL, expires_at: now + TTL, refresh_token, user }; };
        if (p === 'token' && url.searchParams.get('grant_type') === 'password') {
          const u = (await pool.query(`select id from auth.users where lower(email)=lower($1) and encrypted_password = crypt($2, encrypted_password)`, [j.email || '', j.password || ''])).rows[0];
          if (!u) { status = 400; return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' }); }
          return send(res, 200, await session(u.id));
        }
        if (p === 'token' && url.searchParams.get('grant_type') === 'refresh_token') {
          const r = (await pool.query(`delete from auth_shim_refresh where token=$1 returning user_id`, [j.refresh_token])).rows[0];
          if (!r) { status = 400; return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', code: 'refresh_token_not_found' }); }
          return send(res, 200, await session(r.user_id));
        }
        if (p === 'user') { if (!claims || claims.invalid || claims.expired || !claims.sub) { status = 401; return send(res, 401, { code: 401, msg: 'invalid JWT', error_code: 'bad_jwt' }); }
          const u = (await pool.query(`select id, email, raw_user_meta_data from auth.users where id=$1`, [claims.sub])).rows[0]; if (!u) { status = 404; return send(res, 404, { msg: 'user not found' }); }
          return send(res, 200, { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data || {}, app_metadata: { provider: 'email' } }); }
        if (p === 'logout') { res.writeHead(204); return res.end(); }
        status = 404; return send(res, 404, { msg: 'auth endpoint not supported by shim: ' + p });
      }
      if (!url.pathname.startsWith('/rest/v1/')) { status = 404; return send(res, 404, { message: 'not found' }); }
      if (claims && (claims.invalid || claims.expired)) { status = 401; return send(res, 401, { code: 'PGRST301', message: claims.expired ? 'JWT expired' : 'JWT invalid' }); }
      const jwt = claims && claims.role ? claims : { role: 'anon' };
      const path = url.pathname.slice(9);
      if (path.startsWith('rpc/')) {
        const name = path.slice(4); const args = body ? JSON.parse(body) : Object.fromEntries(url.searchParams); const keys = Object.keys(args);
        const cands = (meta.fns[name] || []).filter(f => { const names = (f.proargnames || []).slice(0, f.pronargs); const req = names.slice(0, f.pronargs - f.pronargdefaults); return keys.every(k => names.includes(k)) && req.every(k => keys.includes(k)); });
        if (!cands.length) { status = 404; return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${name}(${keys.join(', ')}) in the schema cache` }); }
        if (cands.length > 1) { const exact = cands.filter(f => (f.proargnames || []).slice(0, f.pronargs).length === keys.length); if (exact.length !== 1) { status = 300; return send(res, 300, { code: 'PGRST203', message: `Could not choose the best candidate function between: ${cands.length} overloads of public.${name}` }); } cands.splice(0, cands.length, exact[0]); }
        const f = cands[0]; const names = (f.proargnames || []).slice(0, f.pronargs); const vals = []; const argSql = keys.map(k => { const ty = f.types[names.indexOf(k)]; const v = args[k]; vals.push(v === null ? null : typeof v === 'object' ? JSON.stringify(v) : v); return `${qi(k)} => $${vals.length}::${ty}`; }).join(', ');
        const scalar = !f.proretset && f.typtype !== 'c';
        const sql = scalar ? `select public.${qi(name)}(${argSql}) as r` : `select coalesce(json_agg(_r), '[]') as r from public.${qi(name)}(${argSql}) _r`;
        const r = await withRole(jwt, c => c.query(sql, vals));
        let out = r.rows[0].r; if (!scalar && !f.proretset) out = out[0] ?? null; if (scalar && out !== null && /^(numeric|integer|bigint|smallint|real|double precision)$/.test(f.rt)) out = Number(out);
        return send(res, 200, out);
      }
      const table = path.replace(/\/$/, ''); qi(table);
      const vals = []; const where = []; let order = '', limit = '', offset = '';
      for (const [k, v] of url.searchParams) {
        if (k === 'select' || k === 'columns' || k === 'on_conflict') continue;
        if (k === 'order') { order = ' order by ' + v.split(',').map(o => { const [c, ...m] = o.split('.'); return `t.${qi(c)} ${m.includes('desc') ? 'desc' : 'asc'}${m.includes('nullslast') ? ' nulls last' : m.includes('nullsfirst') ? ' nulls first' : ''}`; }).join(', '); continue; }
        if (k === 'limit') { limit = ' limit ' + parseInt(v, 10); continue; } if (k === 'offset') { offset = ' offset ' + parseInt(v, 10); continue; }
        if (k === 'or') { where.push(orCond(v, vals)); continue; }
        where.push(cond(k, v, vals));
      }
      const W = where.length ? ' where ' + where.join(' and ') : ''; const prefer = req.headers.prefer || '';
      const single = (req.headers.accept || '').includes('vnd.pgrst.object');
      if (req.method === 'GET' || req.method === 'HEAD') {
        const sel = buildSelect(table, url.searchParams.get('select') || '*', 't');
        const r = await withRole(jwt, async c => { const rows = (await c.query(`select coalesce(json_agg(_q), '[]') r from (select ${sel} from public.${qi(table)} t${W}${order}${limit}${offset}) _q`, vals)).rows[0].r; let cnt = null; if (/count=(exact|planned|estimated)/.test(prefer)) cnt = (await c.query(`select count(*)::int n from public.${qi(table)} t${W}`, vals)).rows[0].n; return { rows, cnt }; });
        const hdr = { 'Content-Range': `0-${Math.max(r.rows.length - 1, 0)}/${r.cnt ?? '*'}` };
        if (single) { if (r.rows.length !== 1) { status = 406; return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${r.rows.length} rows` }); } return send(res, 200, r.rows[0], hdr); }
        if (req.method === 'HEAD') { res.writeHead(200, hdr); return res.end(); }
        return send(res, 200, r.rows, hdr);
      }
      const ret = prefer.includes('return=representation');
      if (req.method === 'POST') {
        const items = [].concat(JSON.parse(body || '[]')); const out = [];
        await withRole(jwt, async c => { for (const it of items) { const ks = Object.keys(it); const v = ks.map(k => it[k] !== null && typeof it[k] === 'object' ? JSON.stringify(it[k]) : it[k]);
          const up = prefer.includes('resolution=merge-duplicates') ? ` on conflict (${(url.searchParams.get('on_conflict') || 'id').split(',').map(qi).join(',')}) do update set ${ks.map(k => `${qi(k)}=excluded.${qi(k)}`).join(',')}` : '';
          out.push((await c.query(`insert into public.${qi(table)} (${ks.map(qi).join(',')}) values (${ks.map((_, i) => '$' + (i + 1)).join(',')})${up} returning *`, v)).rows[0]); } });
        status = 201; return ret ? send(res, 201, single ? out[0] : out) : (res.writeHead(201), res.end());
      }
      if (req.method === 'PATCH') {
        const it = JSON.parse(body || '{}'); const ks = Object.keys(it); const base = vals.length; ks.forEach(k => vals.push(it[k] !== null && typeof it[k] === 'object' ? JSON.stringify(it[k]) : it[k]));
        const r = await withRole(jwt, c => c.query(`update public.${qi(table)} t set ${ks.map((k, i) => `${qi(k)}=$${base + i + 1}`).join(',')}${W} returning *`, vals));
        return ret ? send(res, 200, single ? r.rows[0] : r.rows) : (res.writeHead(204), res.end());
      }
      if (req.method === 'DELETE') { const r = await withRole(jwt, c => c.query(`delete from public.${qi(table)} t${W} returning *`, vals)); return ret ? send(res, 200, r.rows) : (res.writeHead(204), res.end()); }
      status = 405; send(res, 405, { message: 'method not allowed' });
    } catch (e) { status = e.status || 400; pgErr(res, e); }
    finally { reqLog({ t: new Date().toISOString(), m: req.method, p: url.pathname, q: url.search.slice(0, 200), status, ms: Date.now() - t0 }); }
  });
});
pool.query(`create table if not exists auth_shim_refresh(token text primary key, user_id uuid, created_at timestamptz default now()); revoke all on auth_shim_refresh from anon, authenticated;`).then(() => server.listen(Number(process.env.SHIM_PORT || 54321), '127.0.0.1', () => console.log('shim listening 127.0.0.1:' + (process.env.SHIM_PORT || 54321))));
process.on('SIGTERM', () => { require('fs').writeFileSync('/opt/goldia-audit/shim-requests.json', JSON.stringify(log)); process.exit(0); });
