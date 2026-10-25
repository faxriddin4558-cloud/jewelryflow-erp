const { execSync } = require('child_process');

const commits = ['bf07f73', 'b0ff252', '1d8dea5', 'd14f884'];

async function testTokens() {
  console.log('==============================================================================');
  console.log('AUDITING HISTORICAL eyJ... TOKENS IN GIT HISTORY');
  console.log('Rule: Zero secret printing - only reporting active vs revoked status');
  console.log('==============================================================================');

  const projects = [
    { name: 'Staging', url: 'https://vouehtlmsunebracahon.supabase.co' },
    { name: 'Production', url: 'https://vrozlllcaxinavzxueif.supabase.co' },
    { name: 'Factory ERP', url: 'https://hbbuskyifxkowlozsaym.supabase.co' }
  ];

  const foundTokens = new Set();

  for (const c of commits) {
    try {
      const diff = execSync(`git show ${c}`, { encoding: 'utf8' });
      const matches = diff.match(/eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g) || [];
      for (const m of matches) {
        foundTokens.add(m);
      }
    } catch (e) {}
  }

  console.log(`Found ${foundTokens.size} unique JWT tokens in git history.`);

  let tokenIdx = 0;
  for (const token of foundTokens) {
    tokenIdx++;
    // Decode header/payload without secret to see role and ref
    let payload = {};
    try {
      const parts = token.split('.');
      payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    } catch (e) {}

    console.log(`\nToken #${tokenIdx}: role="${payload.role || 'unknown'}", iss="${payload.iss || 'unknown'}", exp=${payload.exp ? new Date(payload.exp * 1000).toISOString() : 'none'}`);

    for (const proj of projects) {
      try {
        const res = await fetch(`${proj.url}/rest/v1/organizations?select=id&limit=1`, {
          headers: {
            'apikey': token,
            'Authorization': `Bearer ${token}`
          }
        });
        if (res.status === 200) {
          console.log(`  🚨 ALERT: Token #${tokenIdx} is ACTIVE on ${proj.name} (${proj.url})!`);
        } else if (res.status === 401 || res.status === 403) {
          console.log(`  ✅ Token #${tokenIdx} on ${proj.name}: Rejected (${res.status} Unauthorized / Forbidden)`);
        } else {
          console.log(`  ❓ Token #${tokenIdx} on ${proj.name}: HTTP ${res.status}`);
        }
      } catch (err) {
        console.log(`  Error probing ${proj.name}: ${err.message}`);
      }
    }
  }

  console.log('\n==============================================================================');
  console.log('AUDIT COMPLETED');
  console.log('==============================================================================');
}

testTokens().catch(console.error);
