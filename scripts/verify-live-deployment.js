const prodUrl = 'https://goldia-sales-production.vercel.app';
const stagingUrl = 'https://jewelryflow-sales-staging.vercel.app';
const targetCommit = '951af97';

async function checkUrl(name, url) {
  console.log(`\nChecking ${name} (${url})...`);
  for (let i = 1; i <= 20; i++) {
    const t0 = Date.now();
    try {
      const verRes = await fetch(`${url}/api/version`, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(8000)
      });
      const elapsed = Date.now() - t0;
      const vercelId = verRes.headers.get('x-vercel-id') || 'none';
      if (verRes.status === 200) {
        const verData = await verRes.json();
        const shortCommit = verData.commit || verData.full_commit?.slice(0, 7);
        console.log(`[Attempt ${i}] /api/version 200 | Commit: ${shortCommit} | DB: ${verData.supabase_ref} | ${elapsed}ms | ${vercelId}`);
        if (shortCommit === targetCommit || verData.full_commit?.startsWith(targetCommit)) {
          console.log(`🎉 ${name} has deployed the new Migration 060 commit (${targetCommit})!`);
          return true;
        }
      } else {
        console.log(`[Attempt ${i}] Status: ${verRes.status} | ${elapsed}ms | ${vercelId}`);
      }
    } catch (err) {
      console.log(`[Attempt ${i}] Error: ${err.message}`);
    }
    if (i < 20) await new Promise(r => setTimeout(r, 6000));
  }
  return false;
}

async function verifyAll() {
  const stagingOk = await checkUrl('Staging', stagingUrl);
  const prodOk = await checkUrl('Production', prodUrl);
  console.log(`\nResult: Staging=${stagingOk ? 'DEPLOYED' : 'PENDING'}, Production=${prodOk ? 'DEPLOYED' : 'PENDING'}`);
}

verifyAll().catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});
