// A — customer creation on STAGING (075) with real GoTrue sessions through the staging PostgREST (API, not browser).
const fs = require('fs');
const { ORG, ORG_B, creds, rpc, sel, uwrite, R, T, op, OPS } = require('./lib');
(async () => {
  const C = creds();
  const mk = async (tag, name, extra = {}) => {
    const r = await rpc(tag, 'rpc_create_customer_with_code', { p_contact_name: name, ...extra });
    op({ step: 'A', action: 'create_customer', actor: tag, name, id: r.ok ? r.data.customer_id : null, code: r.ok ? r.data.customer_code : null, status: r.ok ? r.data.status : 'error', error: r.ok ? null : r.error.slice(0, 120) });
    return r;
  };
  const a1 = await mk('sellera', 'A mijoz 1 (sintetik)');
  const a2 = await mk('sellera', 'A mijoz 2 (sintetik)');
  const b1 = await mk('sellerb', 'B mijoz 1 (sintetik)');
  const c1 = await mk('manager', 'C mijoz 1 (sintetik, menejer)', { p_seller_id: C.sellerc.id });
  T('A1', 'org A: first four customers get CUST-0001..0004 (own numbering, independent of the other 60+ orgs)',
    [a1, a2, b1, c1].every((x) => x.ok) && JSON.stringify([a1, a2, b1, c1].map((x) => x.data.customer_code)) === JSON.stringify(['CUST-0001', 'CUST-0002', 'CUST-0003', 'CUST-0004']),
    ['CUST-0001', 'CUST-0002', 'CUST-0003', 'CUST-0004'], [a1, a2, b1, c1].map((x) => (x.ok ? x.data.customer_code : x.error)));
  const cRow = (await sel(`customers?id=eq.${c1.ok ? c1.data.customer_id : '00000000-0000-0000-0000-000000000000'}&select=seller_id,organization_id`))[0];
  T('A2', 'manager creates a customer for seller C (seller and org stored correctly)', cRow && cRow.seller_id === C.sellerc.id && cRow.organization_id === ORG, { seller: 'sellerc', org: 'A' }, cRow);
  const bb = await mk('sellerB1', 'B-org mijoz 1 (sintetik)');
  T('A3', 'org B starts its own numbering at CUST-0001', bb.ok && bb.data.customer_code === 'CUST-0001', 'CUST-0001', bb.ok ? bb.data.customer_code : bb.error);
  const dup = await mk('sellera', 'a mijoz 1 (SINTETIK)');
  T('A4', 'same name (case-insensitive) for the same seller returns the existing customer', dup.ok && dup.data.status === 'existing' && dup.data.customer_id === a1.data.customer_id, 'existing', dup.ok ? dup.data.status : dup.error);
  const wrk = await mk('worker', 'by worker');
  const other = await mk('sellera', 'for B', { p_seller_id: C.sellerb.id });
  const xorg = await mk('director', 'for org B seller', { p_seller_id: C.sellerB1.id });
  const noemp = await mk('noemp', 'no employee');
  T('A5', 'refused: worker role, seller for another seller, seller of another org, user without employee', !wrk.ok && !other.ok && !xorg.ok && !noemp.ok, 'refused x4', [wrk, other, xorg, noemp].map((x) => (x.ok ? 'ACCEPTED' : x.error.slice(0, 60))));
  // direct writes with the same real sessions
  const direct = {};
  for (const tag of ['sellera', 'manager', 'director', 'sellerB1']) {
    const w = await uwrite(tag, 'POST', 'customers', { organization_id: C[tag].org, customer_code: 'CUST-T999_9999999999999', contact_name: 'direct bypass', seller_id: C[tag].id });
    direct[tag] = w.ok ? 'INSERTED' : `${w.status} ${w.error.slice(0, 50)}`;
    op({ step: 'A', action: 'direct_insert_attempt', actor: tag, expected: 'refused', actual: direct[tag] });
  }
  T('A6', 'direct PostgREST INSERT of a customer (long code) refused for every role', Object.values(direct).every((v) => !v.startsWith('INSERTED')) && (await sel(`customers?contact_name=eq.direct%20bypass&select=id`)).length === 0, 'refused x4', direct);
  const upCode = await uwrite('director', 'PATCH', `customers?id=eq.${a1.data.customer_id}`, { customer_code: 'CUST-T999_9999999999999' });
  const upOrg = await uwrite('director', 'PATCH', `customers?id=eq.${a1.data.customer_id}`, { organization_id: ORG_B });
  const upPhone = await uwrite('director', 'PATCH', `customers?id=eq.${a1.data.customer_id}`, { phone: '+998900750001' });
  const xUpd = await uwrite('directorB', 'PATCH', `customers?id=eq.${a1.data.customer_id}`, { phone: '+998000000000' });
  T('A7', 'direct UPDATE of code/org refused; director edits phone; other org director changes 0 rows', !upCode.ok && !upOrg.ok && upPhone.ok && upPhone.data.length === 1 && (!xUpd.ok || xUpd.data.length === 0),
    { code: 'refused', org: 'refused', phone: 1, foreign: 0 }, { code: upCode.ok ? 'UPDATED' : upCode.error.slice(0, 50), org: upOrg.ok ? 'UPDATED' : upOrg.error.slice(0, 50), phone: upPhone.ok ? upPhone.data.length : upPhone.error, foreign: xUpd.ok ? xUpd.data.length : 'denied' });
  // concurrency: 30 parallel creations (3 sellers + manager) in org A and 10 in org B
  const jobs = [];
  for (let i = 0; i < 30; i++) jobs.push(['sellera', 'sellerb', 'sellerc'][i % 3]);
  const par = await Promise.all([...jobs.map((t, i) => mk(t, `paralel A ${i} (sintetik)`)), ...Array.from({ length: 10 }, (_, i) => mk('sellerB1', `paralel B ${i} (sintetik)`))]);
  const codesA = par.slice(0, 30).filter((x) => x.ok).map((x) => x.data.customer_code);
  const codesB = par.slice(30).filter((x) => x.ok).map((x) => x.data.customer_code);
  const allA = (await sel(`customers?organization_id=eq.${ORG}&select=customer_code`)).map((x) => x.customer_code).sort();
  const expA = Array.from({ length: 34 }, (_, i) => `CUST-${String(i + 1).padStart(4, '0')}`);
  T('A8', '30 parallel creations in org A + 10 in org B: no error, no duplicate, contiguous codes per org', par.every((x) => x.ok) && JSON.stringify(allA) === JSON.stringify(expA) && new Set(codesB).size === 10,
    { orgA: 'CUST-0001..0034', orgB_new: 10 }, { errors: par.filter((x) => !x.ok).map((x) => x.error.slice(0, 60)), orgA_count: allA.length, orgA_last: allA[allA.length - 1], orgB: codesB.sort().join(',') });
  // F-STG-2
  const own = await rpc('director', 'rpc_get_factory_settings', { p_organization_id: ORG });
  const foreign = await rpc('director', 'rpc_get_factory_settings', { p_organization_id: ORG_B });
  const sellerForeign = await rpc('sellera', 'rpc_get_factory_settings', { p_organization_id: '00000000-0000-0000-0000-000000000001' });
  const ne = await rpc('noemp', 'rpc_get_factory_settings', {});
  T('A9', 'factory settings: own org only; other org id refused; no fallback without organization', own.ok && own.data.organizationId === ORG && !foreign.ok && !sellerForeign.ok && !ne.ok, 'own only',
    { own: own.ok && own.data.organizationId, foreign: foreign.ok ? 'RETURNED' : 'refused', seller_foreign: sellerForeign.ok ? 'RETURNED' : 'refused', noemp: ne.ok ? 'RETURNED' : 'refused' });
  fs.writeFileSync(__dirname + '/../evidence/A-customers.json', JSON.stringify({ checks: R, operations: OPS }, null, 1));
  console.log('RESULT A', R.filter((x) => x.ok).length, '/', R.length);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
