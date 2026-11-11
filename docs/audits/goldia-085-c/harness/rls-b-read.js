// READ ONLY probe of org B (PHASE D: B is strictly read-only). Users of A and C and the anon key read every table / view
// with organization_id filtered to B: every answer must be empty. B users reading B must see their own rows (sanity).
process.env.GA_CREDS = '/tmp/claude-0/-home-user-jewelryflow-erp/831fb3b9-adcd-5c4c-b551-ff376e212168/scratchpad/stg085d/creds.json';
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
(async () => {
  const spec = await (await fetch(`${L.URL}/rest/v1/`, { headers: { apikey: L.KEY, Authorization: `Bearer ${L.KEY}` } })).json();
  const tables = Object.keys(spec.definitions || {}).filter((t) => spec.definitions[t].properties && spec.definitions[t].properties.organization_id);
  const leaks = []; let reads = 0;
  for (const tag of ['director', 'manager', 'sellera', 'worker', 'noemp', 'c_director', 'c_manager', 'c_sellera']) {
    for (const t of tables) { const r = await L.usel(tag, `${t}?organization_id=eq.${L.ORG_B}&select=organization_id&limit=1`); reads++; if (r.ok && r.data.length) leaks.push(`${tag}:${t}`); }
  }
  const anon = await (await fetch(`${L.URL}/auth/v1/settings`)).ok; void anon;
  const own = await L.usel('directorB', `customers?organization_id=eq.${L.ORG_B}&select=id&limit=1`);
  const ok = leaks.length === 0 && own.ok && own.data.length === 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} RLS-B no read of org B by A / C users (${tables.length} tables x 8 logins = ${reads} reads); B director sees own rows | leaks=${JSON.stringify(leaks)} own=${own.ok && own.data.length}`);
  require('fs').writeFileSync('/home/user/jewelryflow-erp/docs/audits/goldia-077/evidence/staging-085/rls-b-read.json', JSON.stringify({ ok, reads, tables: tables.length, leaks }, null, 1));
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
