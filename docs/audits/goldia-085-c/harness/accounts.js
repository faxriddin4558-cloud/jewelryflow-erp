// PHASE D account control (staging only). merge: A/B creds + C creds (prefixed c_) into one 0600 file for the suites.
// unban / ban: ONLY the listed synthetic tags (never real staging demo accounts); prints tag + result only.
const fs = require('fs'); const path = require('path');
const SCR = '/tmp/claude-0/-home-user-jewelryflow-erp/831fb3b9-adcd-5c4c-b551-ff376e212168/scratchpad';
const AB = path.join(SCR, 'stg075/creds.json'); const CF = path.join(SCR, 'stg085c/creds.json'); const MERGED = path.join(SCR, 'stg085d/creds.json');
process.env.GA_CREDS = MERGED;
const RUN_TAGS = ['director', 'manager', 'sellera', 'sellerb', 'sellerc', 'worker', 'iddir', 'idmgr', 'noemp', 'directorB', 'sellerB1', 'c_director', 'c_manager', 'c_sellera', 'c_sellerb'];
const ALL_TAGS = [...RUN_TAGS, 'managerB'];
(async () => {
  const cmd = process.argv[2];
  if (cmd === 'merge') {
    const ab = JSON.parse(fs.readFileSync(AB)); const c = JSON.parse(fs.readFileSync(CF)); const m = { ...ab };
    for (const [t, v] of Object.entries(c)) m['c_' + t] = v;
    fs.mkdirSync(path.dirname(MERGED), { recursive: true, mode: 0o700 }); fs.writeFileSync(MERGED, JSON.stringify(m), { mode: 0o600 });
    console.log('merged tags', Object.keys(m).length); return;
  }
  const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
  const m = JSON.parse(fs.readFileSync(MERGED));
  const C_TAGS = ['c_director', 'c_manager', 'c_sellera', 'c_sellerb'];
  const tags = { unban: RUN_TAGS, ban: ALL_TAGS, 'unban-c': C_TAGS, 'ban-c': C_TAGS, 'ban-non-c': ALL_TAGS.filter((t) => !C_TAGS.includes(t)) }[cmd];
  if (!tags) { console.log('usage: merge | unban | ban | unban-c | ban-c | ban-non-c'); process.exit(1); }
  const banning = cmd.startsWith('ban');
  for (const t of tags) {
    const u = m[t]; if (!u || !/@goldia-audit\.test$/.test(u.email)) { console.log(t, 'SKIPPED (not a synthetic account)'); continue; }
    const r = await L.svc('PUT', `auth/v1/admin/users/${u.id}`, { ban_duration: banning ? '876000h' : 'none' });
    console.log(t, r.ok ? (banning ? 'banned' : 'unbanned') : 'FAILED ' + r.status);
  }
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
