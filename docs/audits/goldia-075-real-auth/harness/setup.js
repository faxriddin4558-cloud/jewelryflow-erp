// One synthetic audit organization + real GoTrue users (admin API) on the LOCAL 075 stack, plus one seller and one
// director in stand-in organization 56 (the one holding the planted long customer code). Passwords: random, 0600 file.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { ORG, ORG56, ORG_CODE, CREDS, creds, svc, sel } = require('./lib');
const people = [
  ['director', ORG, 'admin', 'director', 'Director'], ['manager', ORG, 'production_manager', 'production manager', 'Production Manager'],
  ['sellera', ORG, 'sales', 'seller', 'Seller'], ['sellerb', ORG, 'sales', 'seller', 'Seller'], ['sellerc', ORG, 'sales', 'seller', 'Seller'],
  ['worker', ORG, 'worker', 'worker', 'Worker'],
  ['seller56', ORG56, 'sales', 'seller', 'Seller'], ['director56', ORG56, 'director', 'director', 'Director'],
  ['noemp', null, null, null, null],
];
(async () => {
  fs.mkdirSync(path.dirname(CREDS), { recursive: true, mode: 0o700 });
  if (!(await sel(`organizations?id=eq.${ORG}&select=id`)).length) {
    const r = await svc('POST', 'rest/v1/organizations', { id: ORG, code: ORG_CODE, name: 'GOLDIA AUDIT 075 (sintetik)', status: 'ACTIVE' }, { Prefer: 'return=minimal' });
    console.log('org', r.ok ? 'created' : r.error);
  }
  const c = creds();
  for (const [tag, org, role, roleType, position] of people) {
    if (c[tag]) { console.log(tag, 'exists'); continue; }
    const email = `audit075.${tag}@goldia-audit.test`; const password = crypto.randomBytes(18).toString('base64url');
    const u = await svc('POST', 'auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { full_name: `AUDIT ${tag}` } });
    if (!u.ok) { console.log(tag, 'auth create failed', u.status, u.error); continue; }
    const id = u.data.id;
    if (role) {
      const e = await svc('POST', 'rest/v1/employees', { id, user_id: id, employee_code: `AUD75-${tag.toUpperCase()}`, name: `AUDIT ${tag}`, full_name: `AUDIT ${tag}`, email, role, role_type: roleType, position, department: role === 'sales' ? 'Savdo' : 'Boshqaruv', is_active: true, status: 'active', organization_id: org }, { Prefer: 'return=minimal' });
      if (!e.ok) { console.log(tag, 'employee insert failed', e.status, e.error); continue; }
    }
    c[tag] = { email, password, id }; fs.writeFileSync(CREDS, JSON.stringify(c), { mode: 0o600 });
    console.log(tag, 'created');
  }
})();
