const prodUrl = 'https://goldia-sales-production.vercel.app';

async function checkDeployment() {
  console.log('Target URL:', prodUrl);
  for (let i = 1; i <= 15; i++) {
    const t0 = Date.now();
    try {
      const verRes = await fetch(`${prodUrl}/api/version`, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(8000)
      });
      const elapsed = Date.now() - t0;
      const vercelId = verRes.headers.get('x-vercel-id') || 'none';
      if (verRes.status === 200) {
        const verData = await verRes.json();
        console.log(`[Attempt ${i}] /api/version Status: 200 | Commit: ${verData.commit} (${verData.full_commit?.slice(0, 7)}) | DB: ${verData.supabase_ref} | Elapsed: ${elapsed}ms | Vercel ID: ${vercelId}`);
        if (verData.commit === '73b582b' || verData.commit === '52293ef' || verData.full_commit?.startsWith('73b582b') || verData.full_commit?.startsWith('52293ef')) {
          console.log('🎉 Production has deployed the new Migration 059 commit!');
          break;
        }
      } else {
        console.log(`[Attempt ${i}] /api/version Status: ${verRes.status} | Elapsed: ${elapsed}ms | Vercel ID: ${vercelId}`);
      }
    } catch (err) {
      console.log(`[Attempt ${i}] Error: ${err.message}`);
    }
    if (i < 15) await new Promise(r => setTimeout(r, 6000));
  }

  // Also check /sales/app
  const appRes = await fetch(`${prodUrl}/sales/app`, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(8000)
  });
  console.log(`Production /sales/app HTTP status: ${appRes.status}`);
}

checkDeployment().catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});
