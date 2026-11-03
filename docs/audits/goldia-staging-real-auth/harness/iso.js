// Cross-organization isolation on LIVE staging with real JWTs (read-only probes + one non-destructive INSERT probe),
// plus Tashkent business-date boundary via the deployed _goldia_business_date(p_at).
const { URL, KEY, ORG, rpc, usel, uwrite, sel, svc, T, R } = require('./lib');
(async () => {
  const spec = await (await fetch(`${URL}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
  const defs = spec.definitions || {};
  const orgTables = Object.keys(defs).filter((t) => defs[t].properties && defs[t].properties.organization_id);
  const otherOrg = (await sel(`organizations?id=neq.${ORG}&select=id&limit=1&order=created_at`))[0].id;
  const leaks = []; let checks = 0;
  for (const tag of ['director', 'manager', 'sellera', 'noemp']) {
    for (const t of orgTables) {
      const r = await usel(tag, `${t}?organization_id=neq.${ORG}&select=organization_id&limit=1`); checks++;
      if (r.ok && r.data.length) leaks.push(`${tag}:${t}`);
    }
  }
  T('I1', `no foreign-org rows readable (${orgTables.length} org tables/views x 4 logins)`, leaks.length === 0, 0, { checks, leaks });
  const ins = await uwrite('sellera', 'POST', 'customers', { organization_id: otherOrg, customer_code: 'AUD-STG-XORG', contact_name: 'xorg probe', seller_id: null });
  if (ins.ok) await svc('DELETE', `rest/v1/customers?customer_code=eq.AUD-STG-XORG`);
  T('I2', 'seller cannot INSERT a customer into another organization', !ins.ok, 'denied', ins.ok ? 'ACCEPTED (row removed)' : ins.error.slice(0, 70));
  const mgrIns = await uwrite('manager', 'POST', 'jewelry_models', { organization_id: otherOrg, name: 'xorg probe' });
  if (mgrIns.ok) await svc('DELETE', `rest/v1/jewelry_models?name=eq.xorg%20probe`);
  T('I3', 'manager cannot INSERT a jewelry model into another organization (074)', !mgrIns.ok, 'denied', mgrIns.ok ? 'ACCEPTED (row removed)' : mgrIns.error.slice(0, 70));
  // read-only RPCs that accept an org id
  const rpcs = Object.entries(spec.paths).filter(([p, v]) => p.startsWith('/rpc/') && v.post && JSON.stringify(v.post.parameters || []).includes('p_org'));
  const out = {};
  for (const [p, v] of rpcs) {
    const name = p.slice(5); if (!/^(rpc_)?get|report|summary|preview/.test(name)) continue;
    const body = JSON.stringify(v.post.parameters); const arg = /p_organization_id/.test(body) ? 'p_organization_id' : 'p_org_id';
    for (const tag of ['sellera', 'director']) {
      const r = await rpc(tag, name, { [arg]: otherOrg });
      const leaked = r.ok && r.data !== null && !(typeof r.data === 'object' && JSON.stringify(r.data).includes(ORG)) && JSON.stringify(r.data) !== '[]' && JSON.stringify(r.data) !== '0' && JSON.stringify(r.data) !== '{}';
      out[`${tag}:${name}`] = r.ok ? (leaked ? 'DATA:' + JSON.stringify(r.data).slice(0, 80) : 'own/empty') : 'denied';
    }
  }
  const bad = Object.entries(out).filter(([, x]) => x.startsWith('DATA'));
  T('I4', 'read RPCs with an org argument do not return another org\'s data', bad.length === 0, 'none', { tested: Object.keys(out).length, bad, all: out });
  // business date boundary (UTC+5)
  const inst = [['23:59 TKT', '2026-11-25T18:59:00Z', '2026-11-25'], ['00:00 TKT', '2026-11-25T19:00:00Z', '2026-11-26'], ['04:59 TKT', '2026-11-25T23:59:00Z', '2026-11-26'],
    ['month end 23:59', '2026-11-30T18:59:00Z', '2026-11-30'], ['new month 00:00', '2026-11-30T19:00:00Z', '2026-12-01'], ['new year 00:00', '2026-12-31T19:00:00Z', '2027-01-01'], ['new year 05:00', '2027-01-01T00:00:00Z', '2027-01-01']];
  const bd = [];
  for (const [l, at, exp] of inst) { const r = await rpc('sellera', '_goldia_business_date', { p_at: at }); bd.push({ l, at, exp, got: r.ok ? r.data : r.error }); }
  T('D2', 'deployed business date = Asia/Tashkent calendar date at day/month/year boundaries', bd.every((x) => x.got === x.exp), 'all match', bd);
  require('fs').writeFileSync(__dirname + '/../evidence/isolation-and-date.json', JSON.stringify(R, null, 1));
  console.log('RESULT', R.filter((x) => x.ok).length, '/', R.length);
})();
