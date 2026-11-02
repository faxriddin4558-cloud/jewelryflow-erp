const fs = require('fs'); const crypto = require('crypto'); const { URL, KEY } = require('./guard');
const ORG = '00000000-0000-0000-0000-000000000001';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
const people = [['director', 'Director', 'admin', 'director', 'Boshqaruv'], ['manager', 'Production Manager', 'production_manager', 'production manager', 'Boshqaruv'],
  ['sellera', 'Seller', 'sales', 'seller', 'Savdo'], ['sellerb', 'Seller', 'sales', 'seller', 'Savdo'], ['sellerc', 'Seller', 'sales', 'seller', 'Savdo']];
(async () => {
  const credFile = '/opt/goldia-audit/real/creds.json';
  const creds = fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile)) : {};
  for (const [tag, position, role, roleType, dept] of people) {
    const email = `audit.${tag}@goldia-audit.test`;
    if (creds[tag]) { console.log(tag, 'exists'); continue; }
    const password = crypto.randomBytes(18).toString('base64url');
    const r = await fetch(`${URL}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `AUDIT ${tag}`, role, role_type: roleType } }) });
    const u = await r.json(); if (!u.id) { console.log(tag, 'auth create failed', r.status, (u.msg || u.message || '').slice(0, 80)); continue; }
    const e = await fetch(`${URL}/rest/v1/employees`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ id: u.id, user_id: u.id, employee_code: `AUD-${tag.toUpperCase()}`, name: `AUDIT ${tag}`, full_name: `AUDIT ${tag}`, email, role, role_type: roleType, position, department: dept, is_active: true, organization_id: ORG }) });
    if (!e.ok) { console.log(tag, 'employee insert failed', e.status, (await e.text()).slice(0, 120)); continue; }
    creds[tag] = { email, password, id: u.id }; fs.writeFileSync(credFile, JSON.stringify(creds), { mode: 0o600 });
    console.log(tag, 'created');
  }
})();
