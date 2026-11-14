// Cleanup: for each of the 4 D accounts ONLY: sign in once, sign out with scope=global (GoTrue deletes ALL sessions /
// refresh tokens of that user), then ban. Tokens are never printed.
const L = require('./lib');
(async () => {
  const C = L.creds();
  for (const t of ['director', 'manager', 'sellera', 'sellerb']) {
    const u = C[t]; if (!/^audit\.d086\./.test(u.email)) { console.log(t, 'SKIPPED'); continue; }
    const j = await L.login(t);
    const r = await fetch(`${L.URL}/auth/v1/logout?scope=global`, { method: 'POST', headers: { apikey: L.KEY, Authorization: `Bearer ${j.access_token}` } });
    const b = await L.svc('PUT', `auth/v1/admin/users/${u.id}`, { ban_duration: '876000h' });
    console.log(`d_${t} logout(global)=${r.status} ban=${b.ok ? 'ok' : b.status}`);
  }
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
