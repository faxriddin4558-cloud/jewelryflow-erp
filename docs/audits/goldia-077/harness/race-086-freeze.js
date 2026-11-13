// 086 parallel race proof on a REAL PostgreSQL (LOCAL stand-in only, 127.0.0.1:55437), separate connections:
//  RACE-1  a writer already inside its transaction (holding the shared guard lock) while the freeze is set: the freeze
//          WAITS for it; the writer commits; afterwards no new ordinary write gets in
//  RACE-2  20 parallel ordinary writes fired while the freeze is being set: each either committed BEFORE the freeze
//          moment or was refused (ERR_FINANCIAL_FREEZE / ERR_OPENING_DRAFT) - no committed ordinary row is younger
//          than frozen_at, so a dump taken after the freeze contains every committed write
//  RACE-3  the restart (director) inside the freeze passes, ordinary writes during it are refused, other organizations work
//  RACE-4  a long writer (> lock_timeout) makes the freeze fail cleanly (nothing frozen, tool retries)
const { Pool } = require('/opt/goldia-audit/tools/node_modules/pg');
const pool = new Pool({ host: '127.0.0.1', port: 55437, user: 'postgres', database: 'postgres', max: 40 });
const R = []; const T = (id, title, ok, act) => { R.push({ id, title, ok: !!ok, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | ${JSON.stringify(act).slice(0, 260)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function asUser(c, sub) { await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated' })]); await c.query('set local role authenticated'); }
async function legacy(sub, cust, amt, holdMs = 0) {
  const c = await pool.connect(); const t0 = Date.now();
  try {
    await c.query('begin'); await asUser(c, sub);
    await c.query(`select public.rpc_record_client_legacy_debt(p_customer_id := $1, p_balance_type := 'debt', p_amount_585_g := $2, p_as_of_date := current_date)`, [cust, amt]);
    if (holdMs) await c.query(`select pg_sleep(${holdMs / 1000})`);
    await c.query('commit'); return { ok: true, ms: Date.now() - t0, at: Date.now() };
  } catch (e) { await c.query('rollback').catch(() => {}); return { ok: false, error: e.message.slice(0, 60), at: Date.now() }; } finally { c.release(); }
}
const freeze = async (org, on, timeoutOk = false) => {
  const c = await pool.connect(); const t0 = Date.now();
  try { const r = await c.query(`select public._goldia_financial_freeze($1, 'race test', $2) r`, [org, on]); return { ok: true, r: r.rows[0].r, ms: Date.now() - t0, at: Date.now() }; }
  catch (e) { return { ok: false, error: e.message.slice(0, 80), ms: Date.now() - t0 }; } finally { c.release(); }
};
(async () => {
  // a fresh organization of the stand-in with a seller, a customer and a director (no opening yet)
  const orgs = (await pool.query(`select o.id::text id from organizations o where not exists (select 1 from opening_periods p where p.organization_id = o.id)
     and not exists (select 1 from financial_write_freezes f where f.organization_id = o.id)
     and exists (select 1 from employees e where e.organization_id = o.id and e.role::text = 'sales') and exists (select 1 from employees e where e.organization_id = o.id and e.role::text = 'director')
     and exists (select 1 from customers c where c.organization_id = o.id and c.seller_id is not null) order by o.id limit 3`)).rows.map((x) => x.id);
  const ctx = async (org) => {
    const s = (await pool.query(`select e.user_id::text u, e.id::text eid from employees e where e.organization_id = $1 and e.role::text = 'sales' limit 1`, [org])).rows[0];
    const d = (await pool.query(`select e.user_id::text u from employees e where e.organization_id = $1 and e.role::text = 'director' limit 1`, [org])).rows[0];
    const cu = (await pool.query(`select id::text from customers where organization_id = $1 and seller_id = $2 limit 1`, [org, s.eid])).rows[0];
    return { org, s: s.u, d: d.u, cust: cu.id };
  };
  const A = await ctx(orgs[0]); const B = await ctx(orgs[1]); const C = await ctx(orgs[2]);
  // RACE-1
  {
    const w = legacy(A.s, A.cust, 1.11, 2500); await sleep(400);
    const f = freeze(A.org, true); const [wr, fr] = await Promise.all([w, f]);
    const after = await legacy(A.s, A.cust, 1.12);
    T('RACE-1', 'writer inside its transaction while freezing: freeze waits until it commits; the next write is refused', wr.ok && fr.ok && fr.at >= wr.at && fr.ms >= 1500 && !after.ok && /ERR_FINANCIAL_FREEZE/.test(after.error),
      { writer: wr, freezeMs: fr.ms, freezeAfterWriter: fr.at >= wr.at, next: after.error });
    await freeze(A.org, false);
  }
  // RACE-2
  {
    const writes = []; for (let i = 0; i < 20; i++) writes.push((async () => { await sleep(i * 15); return legacy(B.s, B.cust, 2 + i / 100, i % 3 === 0 ? 300 : 0); })());
    await sleep(60); const fr = await freeze(B.org, true); const res = await Promise.all(writes);
    const frozenAt = (await pool.query(`select frozen_at from financial_write_freezes where organization_id = $1 and released_at is null`, [B.org])).rows[0].frozen_at;
    const younger = Number((await pool.query(`select count(*) n from client_legacy_debts where organization_id = $1 and created_at > $2`, [B.org, frozenAt])).rows[0].n);
    const refused = res.filter((r) => !r.ok); const bad = refused.filter((r) => !/ERR_FINANCIAL_FREEZE|ERR_OPENING_DRAFT/.test(r.error));
    T('RACE-2', '20 parallel writes around the freeze: each committed before the freeze moment or refused; no committed ordinary row younger than frozen_at', fr.ok && bad.length === 0 && younger === 0 && refused.length > 0,
      { committed: res.filter((r) => r.ok).length, refused: refused.length, otherErrors: bad.map((x) => x.error), youngerThanFreeze: younger });
  }
  // RACE-3 restart inside B's freeze, parallel ordinary writes, other org C works
  {
    const bv = (await pool.query(`insert into financial_backup_verifications (organization_id, backup_reference, restore_verified) values ($1, 'race 086', true) returning id`, [B.org])).rows[0].id;
    const c = await pool.connect();
    const rs = (async () => { try { await c.query('begin'); await asUser(c, B.d); const r = await c.query(`select public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'race 086', now() - interval '1 minute', $1, 'race-086') r`, [bv]); await c.query('commit'); return { ok: true, r: r.rows[0].r.status }; } catch (e) { await c.query('rollback').catch(() => {}); return { ok: false, error: e.message.slice(0, 80) }; } finally { c.release(); } })();
    const ws = []; for (let i = 0; i < 8; i++) ws.push(legacy(B.s, B.cust, 3 + i / 100));
    const other = legacy(C.s, C.cust, 4.01);
    const [r, ...w] = await Promise.all([rs, ...ws]); const o = await other;
    T('RACE-3', 'restart inside the freeze passes; 8 parallel ordinary writes refused; another organization keeps working', r.ok && w.every((x) => !x.ok && /ERR_FINANCIAL_FREEZE|ERR_OPENING_DRAFT/.test(x.error)) && o.ok,
      { restart: r, refused: w.filter((x) => !x.ok).length, errors: [...new Set(w.map((x) => x.error || 'OK'))], otherOrg: o.ok });
  }
  // RACE-4 a writer longer than lock_timeout: the freeze fails cleanly (no freeze row), then succeeds after it
  {
    const w = legacy(C.s, C.cust, 5.01, 34000); await sleep(400);
    const fr = await freeze(C.org, true); const wr = await w;
    const rows = Number((await pool.query(`select count(*) n from financial_write_freezes where organization_id = $1 and released_at is null`, [C.org])).rows[0].n);
    const fr2 = await freeze(C.org, true);
    T('RACE-4', 'a writer longer than lock_timeout (30 s): the freeze fails with a lock timeout and leaves nothing; a retry after it succeeds', !fr.ok && /lock timeout|canceling statement/i.test(fr.error) && rows === 0 && wr.ok && fr2.ok,
      { first: fr.error, frozenRowsAfterFail: rows, writer: wr.ok, retry: fr2.ok && fr2.r.status });
    await freeze(C.org, false);
  }
  require('fs').writeFileSync('/home/user/jewelryflow-erp/docs/audits/goldia-077/evidence/phase-f2/race-086.json', JSON.stringify(R, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`); await pool.end();
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
