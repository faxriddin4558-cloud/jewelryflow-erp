const STAGING_URL = 'https://jewelryflow-sales-staging.vercel.app';
const PROD_URL = 'https://goldia-sales-production.vercel.app';
const TARGET_COMMIT = '3b58b60';

async function checkUrl(url, name) {
  try {
    const res = await fetch(`${url}/api/version`, { cache: 'no-store' });
    if (!res.ok) return { name, ready: false, status: res.status };
    const json = await res.json();
    return { name, ready: json.commit?.startsWith(TARGET_COMMIT) || TARGET_COMMIT.startsWith(json.commit || ''), data: json };
  } catch (err) {
    return { name, ready: false, error: err.message };
  }
}

async function main() {
  console.log(`Checking deployments for commit ${TARGET_COMMIT}...`);
  const [sRes, pRes] = await Promise.all([
    checkUrl(STAGING_URL, 'Staging'),
    checkUrl(PROD_URL, 'Production')
  ]);
  console.log('Staging:', sRes);
  console.log('Production:', pRes);
  return sRes.ready && pRes.ready;
}

main().then(ready => {
  if (!ready) process.exit(2);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
