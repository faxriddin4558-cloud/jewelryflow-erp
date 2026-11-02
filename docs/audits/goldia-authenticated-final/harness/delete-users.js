const fs = require('fs'); const { URL, KEY } = require('./guard');
const creds = JSON.parse(fs.readFileSync('/opt/goldia-audit/real/creds.json'));
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
(async () => { for (const [k, v] of Object.entries(creds)) {
  if (!v.email.endsWith('@goldia-audit.test')) { console.log('skip', k); continue; }
  const e = await fetch(`${URL}/rest/v1/employees?id=eq.${v.id}&email=eq.${encodeURIComponent(v.email)}`, { method: 'DELETE', headers: H });
  const u = await fetch(`${URL}/auth/v1/admin/users/${v.id}`, { method: 'DELETE', headers: H });
  console.log(k, 'employee', e.status, 'auth', u.status);
} })();
