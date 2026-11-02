// Calls every SECURITY DEFINER function executable by `authenticated` with NULL args, as several low-privilege identities.
// Each call runs in a transaction that is ALWAYS rolled back.
const { pool, U } = require('./lib');
(async () => {
  const fns = (await pool.query(`select p.oid, p.proname, p.pronargs, pg_get_function_identity_arguments(p.oid) args, p.prorettype::regtype::text rt
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prokind='f'
     and has_function_privilege('authenticated', p.oid, 'execute') and p.prorettype <> 'trigger'::regtype order by 2`)).rows;
  const who = { NOEMP: U.NOEMP, NOORG: U.NOORG, INACTIVE: U.SX, SELLER_A: U.SA, OTHER_ORG_DIR: U.DB };
  const results = [];
  for (const f of fns) {
    const row = { fn: f.proname, args: f.args };
    for (const [k, uid] of Object.entries(who)) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
        await c.query('set local role authenticated');
        const argList = Array.from({ length: f.pronargs }, () => 'null').join(',');
        const r = await c.query(`select public.${f.proname}(${argList})::text as r`);
        const v = r.rows[0].r;
        row[k] = 'OK:' + (v === null ? 'null' : v.slice(0, 80));
      } catch (e) { row[k] = 'ERR:' + e.message.slice(0, 60); }
      finally { await c.query('rollback').catch(() => {}); c.release(); }
    }
    results.push(row);
  }
  require('fs').writeFileSync('/opt/goldia-audit/sweep.json', JSON.stringify(results, null, 1));
  for (const r of results) {
    const oks = Object.keys(who).filter(k => r[k].startsWith('OK:') && !/^OK:(null|0|false|\[\]|\{\}|0\.0000)$/.test(r[k]));
    if (oks.length) console.log(r.fn, '| returns data for:', oks.join(','), '|', r.NOEMP.slice(0, 90));
  }
  console.log('total functions swept:', results.length);
  await pool.end();
})();
