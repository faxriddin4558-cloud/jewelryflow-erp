// Real PostgreSQL 17 (multi-connection) concurrency + RLS probe for 075. LOCAL disposable stack only (127.0.0.1:55437).
// Usage: node pg17-concurrency.js <label>   — runs against whatever schema state (074 or 075) the local DB is in.
const { Pool } = require(process.env.PG_MODULE || '/opt/goldia-audit/tools/node_modules/pg');
const HOST = process.env.GA_PGHOST || '127.0.0.1'; const PORT = Number(process.env.GA_PGPORT || 55437);
if (!/^(127\.0\.0\.1|localhost)$/.test(HOST)) throw new Error('local only');
const pool = new Pool({ host: HOST, port: PORT, user: 'postgres', database: 'postgres', max: 80 });
const label = process.argv[2] || 'run';
const ORG = ['c0750000-0000-4000-8000-00000000000a', 'c0750000-0000-4000-8000-00000000000b'];
const uid = (o, n) => `c075${o}${String(n).padStart(3, '0')}-0000-4000-8000-000000000000`.replace(/^(.{8})(.*)$/, (m, a, b) => a + b);
const R = []; const T = (id, title, ok, d) => { R.push({ id, title, ok: !!ok, detail: d }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | ' + JSON.stringify(d).slice(0, 260)); };
async function as(sub, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    const r = await c.query(sql, params); await c.query('commit'); return { ok: true, rows: r.rows };
  } catch (e) { await c.query('rollback').catch(() => {}); return { ok: false, error: e.message, code: e.code }; } finally { c.release(); }
}
(async () => {
  const su = (s, p) => pool.query(s, p);
  const run = label.replace(/\W/g, '').slice(0, 10);
  // fresh synthetic orgs per run
  const users = {};
  for (const [i, org] of ORG.entries()) {
    const o = 'ab'[i];
    await su(`delete from public.client_gold_accounts where organization_id = $1`, [org]).catch(() => {});
    await su(`alter table public.customers disable trigger trg_guard_customer_deletion`).catch(() => {});
    await su(`delete from public.customers where organization_id = $1`, [org]);
    await su(`alter table public.customers enable trigger trg_guard_customer_deletion`).catch(() => {});
    await su(`insert into public.organizations (id, code, name, status) values ($1, $2, $3, 'ACTIVE') on conflict (id) do nothing`, [org, `conc-${o}`, `Concurrency ${o}`]);
    for (const [n, role] of [[1, 'director'], [2, 'sales'], [3, 'sales']]) {
      const id = `c0750000-0000-4000-8${i}00-00000000000${n}`;
      await su(`insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated') on conflict (id) do nothing`, [id, `conc-${o}${n}@audit.test`]);
      await su(`insert into public.employees (id, user_id, organization_id, name, full_name, role, is_active, status) values ($1, $1, $2, $3, $3, $4, true, 'active') on conflict (id) do nothing`, [id, org, `C ${o}${n}`, role]);
      users[`${o}${n}`] = id;
    }
  }
  // planted long code in org B (the staging shape) — as postgres, because 075 forbids the direct INSERT
  if (!process.env.NO_PLANT) await su(`insert into public.customers (organization_id, customer_code, contact_name) values ($1, 'CUST-T056_1793002353699', 'planted')`, [ORG[1]]);
  const create = (sub, name) => as(sub, `select public.rpc_create_customer_with_code(p_contact_name => $1) r`, [name]);
  // C1: 60 parallel creations in org A from two sellers + director
  const subsA = [users.a1, users.a2, users.a3];
  const c1 = await Promise.all(Array.from({ length: 60 }, (_, k) => create(subsA[k % 3], `${run} A ${k}`)));
  const okA = c1.filter((x) => x.ok).map((x) => x.rows[0].r.customer_code);
  const errsA = [...new Set(c1.filter((x) => !x.ok).map((x) => x.error.slice(0, 70)))];
  const expectA = Array.from({ length: 60 }, (_, k) => `CUST-${String(k + 1).padStart(4, '0')}`);
  T('C1', '60 parallel creations in one org: 60 distinct consecutive codes, no error', okA.length === 60 && new Set(okA).size === 60 && JSON.stringify([...okA].sort()) === JSON.stringify(expectA), { ok: okA.length, distinct: new Set(okA).size, errors: errsA });
  // C2: same name 12x in parallel (same seller) -> one customer
  const c2 = await Promise.all(Array.from({ length: 12 }, () => create(users.a2, `${run} same name`)));
  const n2 = (await su(`select count(*)::int n from public.customers where organization_id = $1 and contact_name = $2`, [ORG[0], `${run} same name`])).rows[0].n;
  T('C2', '12 parallel creations of the same name: exactly one customer', n2 === 1, { customers: n2, statuses: [...new Set(c2.map((x) => (x.ok ? x.rows[0].r.status : x.error.slice(0, 50))))] });
  // C3: both orgs in parallel; org B holds the planted long code
  const c3 = await Promise.all(Array.from({ length: 40 }, (_, k) => create(k % 2 ? users.b2 : users.a3, `${run} X ${k}`)));
  const okB = c3.filter((x, k) => k % 2 && x.ok).map((x) => x.rows[0].r.customer_code).sort();
  const errs3 = [...new Set(c3.filter((x) => !x.ok).map((x) => x.error.slice(0, 70)))];
  T('C3', 'parallel creations in two orgs; planted long code in org B does not overflow; org B numbers from 1', errs3.length === 0 && okB[0] === 'CUST-0001' && new Set(okB).size === 20, { orgB_first: okB[0], orgB_last: okB[okB.length - 1], errors: errs3 });
  // C4: direct INSERT by sellers (RLS-allowed shape at 074) in parallel
  const c4 = await Promise.all([users.a2, users.b2].map((s, i) => as(s, `insert into public.customers (organization_id, customer_code, contact_name, seller_id) values ($1, 'CUST-T999_9999999999999', 'direct', $2) returning id`, [ORG[i], s])));
  T('C4', 'direct INSERT of a customer (with a long code) by a seller is refused', c4.every((x) => !x.ok), c4.map((x) => (x.ok ? 'INSERTED' : x.error.slice(0, 60))));
  // C5: factory settings lazy-create race + foreign org id
  await su(`delete from public.organization_factory_settings where organization_id = any($1)`, [ORG]);
  const c5 = await Promise.all(Array.from({ length: 10 }, () => as(users.a1, `select public.rpc_get_factory_settings(null) r`)));
  const rowsA = (await su(`select count(*)::int n from public.organization_factory_settings where organization_id = $1`, [ORG[0]])).rows[0].n;
  const foreign = await as(users.a2, `select public.rpc_get_factory_settings($1) r`, [ORG[1]]);
  T('C5', '10 parallel first reads of own factory settings: one row, no error; another org id refused', c5.every((x) => x.ok) && rowsA === 1 && !foreign.ok, { errors: [...new Set(c5.filter((x) => !x.ok).map((x) => x.error.slice(0, 60)))], rows: rowsA, foreign: foreign.ok ? 'RETURNED ' + foreign.rows[0].r.organizationId : foreign.error.slice(0, 60) });
  // C6: cross-org read of customers stays 0
  const c6 = await as(users.a2, `select count(*)::int n from public.customers where organization_id <> $1`, [ORG[0]]);
  T('C6', 'seller reads no other organization customers', c6.ok && c6.rows[0].n === 0, c6.ok ? c6.rows[0].n : c6.error);
  require('fs').writeFileSync(`${__dirname}/../evidence/pg17-concurrency-${label}.json`, JSON.stringify(R, null, 1));
  console.log('RESULT', label, R.filter((x) => x.ok).length, '/', R.length);
  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
