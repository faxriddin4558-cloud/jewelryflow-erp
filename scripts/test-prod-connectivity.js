const dns = require('dns');
const fs = require('fs');
const path = require('path');

function getProductionUrl() {
  const envPath = path.resolve(__dirname, '../.env.production.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (k === 'NEXT_PUBLIC_SUPABASE_URL') return v;
      }
    }
  }
  return process.argv[2] || null;
}

async function testConnectivity() {
  const rawUrl = getProductionUrl();
  console.log('==============================================================================');
  console.log('JEWELRYFLOW SALES — PRODUCTION CONNECTIVITY TEST');
  console.log('==============================================================================');

  if (!rawUrl) {
    console.log('❌ URL TOPILMADI: .env.production.local faylida NEXT_PUBLIC_SUPABASE_URL yo\'q');
    console.log('   yoki buyruq argumenti sifatida uzatilmadi.');
    return { status: 'FAIL', reason: 'NO_URL' };
  }

  let hostname = '';
  try {
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    hostname = parsed.hostname;
  } catch (e) {
    console.log('❌ URL FORMATI NOTO\'G\'RI:', rawUrl);
    return { status: 'FAIL', reason: 'INVALID_URL' };
  }

  console.log(`Tekshirilayotgan Hostname: ${hostname}`);

  // 1. DNS TEST
  console.log('\n[1/3] DNS Resolution Test:');
  try {
    const addresses = await dns.promises.resolve4(hostname);
    console.log(`  ✅ DNS PASS: IP manzillari aniqlandi -> ${addresses.join(', ')}`);
  } catch (err) {
    console.log(`  ❌ DNS FAIL (${err.code}): ${hostname} domeni internetda topilmadi.`);
    console.log('     Sabab: Dashboard\'dagi Project Reference / URL xato ko\'chirilgan yoki loyiha hali yaratilmoqda.');
    return { status: 'FAIL', reason: 'DNS_ENOTFOUND' };
  }

  // 2. HTTPS AUTH HEALTH TEST
  console.log('\n[2/3] HTTPS Auth Health Endpoint:');
  const healthUrl = `https://${hostname}/auth/v1/health`;
  try {
    const res = await fetch(healthUrl);
    const data = await res.json();
    console.log(`  ✅ HTTPS Health PASS: HTTP ${res.status} OK`, data);
  } catch (err) {
    console.log(`  ❌ HTTPS Health FAIL: ${err.message}`);
    return { status: 'FAIL', reason: 'HTTPS_FAILED' };
  }

  // 3. REST API ENDPOINT TEST
  console.log('\n[3/3] REST API Endpoint Reachability:');
  const restUrl = `https://${hostname}/rest/v1/`;
  try {
    const res = await fetch(restUrl);
    console.log(`  ✅ REST API PASS: HTTP ${res.status} (${res.statusText || 'Reachable'})`);
  } catch (err) {
    console.log(`  ❌ REST API FAIL: ${err.message}`);
    return { status: 'FAIL', reason: 'REST_FAILED' };
  }

  console.log('\n==============================================================================');
  console.log('ULANISH NATIJASI: 100% PASS (Supabase Serveri Ishlamoqda)');
  console.log('==============================================================================');
  return { status: 'PASS' };
}

testConnectivity().catch(console.error);
