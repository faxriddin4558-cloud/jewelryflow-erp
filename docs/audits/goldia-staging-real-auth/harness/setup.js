// Creates ONE dedicated synthetic organization + 5 real GoTrue users (+1 auth user without employee) on STAGING.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { ORG, ORG_CODE, CREDS, creds, svc, sel } = require('./lib');
const people = [['director', 'Director', 'admin', 'director'], ['manager', 'Production Manager', 'production_manager', 'production manager'],
  ['sellera', 'Seller', 'sales', 'seller'], ['sellerb', 'Seller', 'sales', 'seller'], ['sellerc', 'Seller', 'sales', 'seller'], ['noemp', null, null, null]];
(async () => {
  fs.mkdirSync(path.dirname(CREDS), { recursive: true, mode: 0o700 });
  const org = await sel(`organizations?id=eq.${ORG}&select=id,code`);
  if (!org.length) { const r = await svc('POST', 'rest/v1/organizations', { id: ORG, code: ORG_CODE, name: 'GOLDIA AUDIT (sintetik, real Auth) 2026-11-03', status: 'ACTIVE' }, { Prefer: 'return=minimal' }); console.log('org', r.ok ? 'created' : r.error); } else console.log('org exists');
  const c = creds();
  for (const [tag, position, role, roleType] of people) {
    if (c[tag]) { console.log(tag, 'exists'); continue; }
    const email = `audit.stg.${tag}@goldia-audit.test`; const password = crypto.randomBytes(18).toString('base64url');
    const u = await svc('POST', 'auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { full_name: `AUDIT ${tag}`, audit: true } });
    if (!u.ok) { console.log(tag, 'auth create failed', u.status, u.error); continue; }
    const id = u.data.id;
    if (role) {
      const e = await svc('POST', 'rest/v1/employees', { id, user_id: id, employee_code: `AUD-STG-${tag.toUpperCase()}`, name: `AUDIT ${tag}`, full_name: `AUDIT ${tag}`, email, role, role_type: roleType, position, department: role === 'sales' ? 'Savdo' : 'Boshqaruv', is_active: true, status: 'active', organization_id: ORG }, { Prefer: 'return=minimal' });
      if (!e.ok) { console.log(tag, 'employee insert failed', e.status, e.error); continue; }
    }
    c[tag] = { email, password, id }; fs.writeFileSync(CREDS, JSON.stringify(c), { mode: 0o600 });
    console.log(tag, 'created');
  }
})();
