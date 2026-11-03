// Two synthetic organizations on STAGING + real GoTrue users (admin API). Passwords random, only in a 0600 file.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { ORG, ORG_B, ORG_CODE, ORG_B_CODE, CREDS, creds, svc, sel } = require('./lib');
const people = [
  ['director', ORG, 'admin', 'director', 'Director'], ['manager', ORG, 'production_manager', 'production manager', 'Production Manager'],
  ['sellera', ORG, 'sales', 'seller', 'Seller'], ['sellerb', ORG, 'sales', 'seller', 'Seller'], ['sellerc', ORG, 'sales', 'seller', 'Seller'],
  ['worker', ORG, 'worker', 'worker', 'Worker'],
  ['directorB', ORG_B, 'admin', 'director', 'Director'], ['managerB', ORG_B, 'production_manager', 'production manager', 'Production Manager'],
  ['sellerB1', ORG_B, 'sales', 'seller', 'Seller'],
  ['noemp', null, null, null, null],
];
(async () => {
  fs.mkdirSync(path.dirname(CREDS), { recursive: true, mode: 0o700 });
  for (const [id, code, name] of [[ORG, ORG_CODE, 'GOLDIA AUDIT 075 A (sintetik)'], [ORG_B, ORG_B_CODE, 'GOLDIA AUDIT 075 B (sintetik)']]) {
    if (!(await sel(`organizations?id=eq.${id}&select=id`)).length) {
      const r = await svc('POST', 'rest/v1/organizations', { id, code, name, status: 'ACTIVE' }, { Prefer: 'return=minimal' });
      console.log('org', code, r.ok ? 'created' : r.error);
    } else console.log('org', code, 'exists');
  }
  const c = creds();
  for (const [tag, org, role, roleType, position] of people) {
    if (c[tag]) { console.log(tag, 'exists'); continue; }
    const email = `audit.stg075.${tag.toLowerCase()}@goldia-audit.test`; const password = crypto.randomBytes(18).toString('base64url');
    const u = await svc('POST', 'auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { full_name: `AUDIT075 ${tag}`, audit: true } });
    if (!u.ok) { console.log(tag, 'auth create failed', u.status, u.error); continue; }
    const id = u.data.id;
    if (role) {
      const e = await svc('POST', 'rest/v1/employees', { id, user_id: id, employee_code: `A75-${tag.toUpperCase()}`, name: `AUDIT075 ${tag}`, full_name: `AUDIT075 ${tag}`, email, role, role_type: roleType, position, department: role === 'sales' ? 'Savdo' : 'Boshqaruv', is_active: true, status: 'active', organization_id: org }, { Prefer: 'return=minimal' });
      if (!e.ok) { console.log(tag, 'employee insert failed', e.status, e.error); continue; }
    }
    c[tag] = { email, password, id, org }; fs.writeFileSync(CREDS, JSON.stringify(c), { mode: 0o600 });
    console.log(tag, 'created');
  }
})();
