const url = 'https://goldia-sales-production.vercel.app/sales/app';

async function checkDeployment() {
  console.log('Target URL:', url);
  for (let i = 1; i <= 6; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(6000)
      });
      const elapsed = Date.now() - t0;
      const vercelId = res.headers.get('x-vercel-id') || 'none';
      console.log(`[Attempt ${i}] Status: ${res.status} | Elapsed: ${elapsed}ms | Vercel ID: ${vercelId}`);
      if (res.status === 200) {
        console.log('✅ Production app is LIVE and responding HTTP 200 OK!');
        return;
      }
    } catch (err) {
      console.log(`[Attempt ${i}] Error: ${err.message}`);
    }
    if (i < 6) await new Promise(r => setTimeout(r, 5000));
  }
}

checkDeployment().catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});
