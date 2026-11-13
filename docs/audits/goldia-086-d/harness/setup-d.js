// Creates ONLY: organization D + 4 GoTrue users (audit.d086.*@goldia-audit.test) + their 4 employee rows in D.
// Idempotent; passwords random, kept only in the 0600 credentials file; nothing secret is printed.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const L = require('./lib');
const people = [['director', 'admin', 'director', 'Boshqaruv'], ['manager', 'production_manager', 'production manager', 'Boshqaruv'],
  ['sellera', 'sales', 'seller', 'Savdo'], ['sellerb', 'sales', 'seller', 'Savdo']];
(async () => {
  fs.mkdirSync(path.dirname(L.CREDS), { recursive: true, mode: 0o700 });
  if (!(await L.sel(`organizations?id=eq.${L.ORG}&select=id`)).length) {
    const r = await L.svc('POST', 'rest/v1/organizations', { id: L.ORG, code: L.ORG_CODE, name: 'GOLDIA AUDIT 086 D (sintetik)', status: 'ACTIVE' }, { Prefer: 'return=minimal' });
    console.log('org D', r.ok ? 'created' : 'FAILED ' + r.error); if (!r.ok) process.exit(1);
  } else console.log('org D exists');
  const c = fs.existsSync(L.CREDS) ? JSON.parse(fs.readFileSync(L.CREDS)) : {};
  for (const [tag, role, roleType, dept] of people) {
    if (c[tag]) { console.log(tag, 'exists'); continue; }
    const email = `audit.d086.${tag}@goldia-audit.test`; const password = crypto.randomBytes(18).toString('base64url');
    const u = await L.svc('POST', 'auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { full_name: `AUDIT086D ${tag}`, audit: true } });
    if (!u.ok) { console.log(tag, 'auth create FAILED', u.status, u.error); process.exit(1); }
    const id = u.data.id;
    const e = await L.svc('POST', 'rest/v1/employees', { id, user_id: id, employee_code: `D086-${tag.toUpperCase()}`, name: `AUDIT086D ${tag}`, full_name: `AUDIT086D ${tag}`, email, role,
      role_type: roleType, position: roleType, department: dept, is_active: true, status: 'active', organization_id: L.ORG }, { Prefer: 'return=minimal' });
    if (!e.ok) { console.log(tag, 'employee FAILED', e.status, e.error); process.exit(1); }
    c[tag] = { email, password, id, org: L.ORG }; fs.writeFileSync(L.CREDS, JSON.stringify(c), { mode: 0o600 });
    console.log(tag, 'created', id.slice(0, 8));
  }
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
