// PostgREST-equivalent request emulation against the ISOLATED local cluster only.
const { Pool } = require('pg');
const HOST = '/opt/goldia-audit/pg';
if (process.env.PGHOST && !process.env.PGHOST.startsWith('/opt/goldia-audit')) throw new Error('refusing non-local host');
const pool = new Pool({ host: HOST, port: 55432, user: 'postgres', database: 'postgres', max: 20 });
const U = {
  D: 'a0000000-0000-4000-8000-000000000001', M: 'a0000000-0000-4000-8000-000000000002',
  SA: 'a0000000-0000-4000-8000-00000000000a', SB: 'a0000000-0000-4000-8000-00000000000b',
  SC: 'a0000000-0000-4000-8000-00000000000c', SX: 'a0000000-0000-4000-8000-0000000000dd',
  NOEMP: 'a0000000-0000-4000-8000-0000000000ee', NOORG: 'a0000000-0000-4000-8000-0000000000ff',
  DB: 'b0000000-0000-4000-8000-000000000001', ANON: null,
};
const NAME = Object.fromEntries(Object.entries(U).map(([k, v]) => [v, k]));
// one request = one transaction, role switched like PostgREST
const subCache = {};
async function req(uid, sql, params = [], { hold = 0 } = {}) {
  if (uid && process.env.SEED2) { if (!subCache[uid]) { const r = await pool.query(`select coalesce((select user_id::text from employees where id::text=$1), $1) s`, [uid]); subCache[uid] = r.rows[0].s; } uid = subCache[uid]; }
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (uid) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await c.query('set local role authenticated');
    } else {
      await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await c.query('set local role anon');
    }
    const r = await c.query(sql, params);
    if (hold) await c.query('select pg_sleep($1)', [hold]);
    await c.query('commit');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    return { ok: false, error: e.message, code: e.code };
  } finally { c.release(); }
}
// call rpc with named args, like supabase.rpc(name, args)
async function rpc(uid, name, args = {}, opts) {
  const keys = Object.keys(args);
  const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  const res = await req(uid, sql, keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])), opts);
  return res.ok ? { ok: true, data: res.rows[0].r } : res;
}
async function su(sql, params = []) { return (await pool.query(sql, params)).rows; }
const log = [];
function rec(id, title, result, extra = {}) { const e = { id, title, ...extra, result }; log.push(e); console.log(JSON.stringify(e)); return result; }
module.exports = { pool, U, NAME, req, rpc, su, rec, log };
