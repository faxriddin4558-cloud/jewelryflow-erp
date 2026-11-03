// F-STG-1 probe: can a tenant seller set an arbitrary customer_code through PostgREST? (harmless code, own org)
const { ORG, creds, uwrite, rpc, T, R } = require('./lib');
(async () => {
  const C = creds();
  const r = await rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: 'probe (sintetik)' });
  T('F1a', 'rpc_create_customer_with_code works on staging', r.ok, 'ok', r.ok ? r.data : r.error);
  const out = {};
  for (const [tag, code, name] of [['sellera', 'AUD-STG-A1', 'A mijoz 1 (sintetik)'], ['sellera', 'AUD-STG-A2', 'A mijoz 2 (sintetik)'], ['sellerb', 'AUD-STG-B1', 'B mijoz 1 (sintetik)']]) {
    const w = await uwrite(tag, 'POST', 'customers', { organization_id: ORG, customer_code: code, contact_name: name, seller_id: C[tag].id });
    out[code] = w.ok ? w.data[0].id : w.error;
  }
  T('F1b', 'tenant seller can INSERT a customer with an arbitrary customer_code directly (bypassing the RPC)', Object.values(out).every((v) => /^[0-9a-f-]{36}$/.test(v)), 'documented behaviour', out);
  require('fs').writeFileSync(__dirname + '/../evidence/customer-code-probe.json', JSON.stringify(R, null, 1));
  require('fs').writeFileSync(require('path').dirname(require('./lib').CREDS) + '/customers.json', JSON.stringify(out));
})();
