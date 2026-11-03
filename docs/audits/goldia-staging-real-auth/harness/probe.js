const { login, usel, rpc } = require('./lib');
(async () => {
  for (const t of ['director', 'manager', 'sellera', 'noemp']) {
    const j = await login(t);
    const o = await usel(t, 'organizations?select=id');
    const e = await usel(t, 'employees?select=id');
    console.log(t, 'login ok; orgs visible:', o.ok ? o.data.length : o.error, '; employees visible:', e.ok ? e.data.length : e.error);
  }
  const bad = await fetch(require('./lib').URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: require('./lib').KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: require('./lib').creds().sellera.email, password: 'wrong-password-x' }) });
  console.log('wrong password status', bad.status);
})();
