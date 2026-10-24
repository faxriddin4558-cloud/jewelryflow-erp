/**
 * JEWELRYFLOW SALES — PHASE A: READ-ONLY STAGING VS PRODUCTION RECONCILIATION
 * 
 * Ushbu skript barcha ma'lumotlarni FAQAT READ-ONLY tarzda tahlil qiladi.
 * Hech qanday yozish, o'chirish, reset yoki modifikatsiya bajarilmaydi.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROD_ENV_PATH = path.resolve(__dirname, '../.env.production.local');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const res = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      res[trimmed.slice(0, idx).trim()] = v;
    }
  }
  return res;
}

function getStagingKeys() {
  const raw = execSync('npx supabase projects api-keys --project-ref vouehtlmsunebracahon --output json', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const jsonStart = raw.indexOf('[');
  const jsonEnd = raw.lastIndexOf(']') + 1;
  const keys = JSON.parse(raw.slice(jsonStart, jsonEnd));
  let anonKey = '', serviceRoleKey = '';
  for (const k of keys) {
    if (k.name === 'anon') anonKey = k.api_key;
    if (k.name === 'service_role') serviceRoleKey = k.api_key;
  }
  return { anonKey, serviceRoleKey };
}

async function fetchPostgrest(url, serviceKey, pathStr) {
  try {
    const res = await fetch(`${url}/rest/v1/${pathStr}`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'count=exact'
      }
    });
    if (!res.ok) {
      return { ok: false, status: res.status, statusText: res.statusText, data: null };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data, headers: res.headers };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function runReconciliation() {
  console.log('==============================================================================');
  console.log('JEWELRYFLOW SALES — READ-ONLY STAGING VS PRODUCTION AUDIT');
  console.log('==============================================================================');

  const prodEnv = parseEnv(PROD_ENV_PATH);
  const stagingKeys = getStagingKeys();

  const stagingUrl = 'https://vouehtlmsunebracahon.supabase.co';
  const prodUrl = prodEnv.NEXT_PUBLIC_SUPABASE_URL || 'https://vrozlllcaxinavzxueif.supabase.co';

  console.log('\n[1/6] LOYIHA VA HOST IDENTIFIKATSIYASI:');
  console.log('  Staging Target:     vouehtlmsunebracahon ->', stagingUrl);
  console.log('  Production Target:  vrozlllcaxinavzxueif ->', prodUrl);

  // 1. GIT VA VERCEL DEPLOYMENT PARITY
  console.log('\n[2/6] GIT VA VERCEL DEPLOYMENT COMMITS:');
  const localHead = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const remoteHead = execSync('git rev-parse origin/feature/jewelryflow-sales-mvp', { encoding: 'utf8' }).trim();
  console.log(`  Local HEAD:         ${localHead}`);
  console.log(`  Remote HEAD:        ${remoteHead}`);
  console.log(`  Git Sync:           ${localHead === remoteHead ? 'IN SYNC ✅' : 'DIVERGED ⚠️'}`);

  const vercelData = JSON.parse(execSync('node scripts/audit-deployments-and-git.js', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).split('=== VERCEL DEPLOYMENT & PROJECT AUDIT ===')[1] ? '{}' : '{}');
  // Read Vercel API directly
  try {
    const stgProj = JSON.parse(execSync('npx vercel api /v9/projects/jewelryflow-sales-staging?teamId=team_GPJgf92gZPMLY35ES6gHd4mG', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
    const prodProj = JSON.parse(execSync('npx vercel api /v9/projects/goldia-sales-production?teamId=team_GPJgf92gZPMLY35ES6gHd4mG', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
    
    console.log(`  Staging Vercel:     ${stgProj.targets?.production?.meta?.githubCommitSha?.slice(0, 7)} (Target) | ${stgProj.latestDeployments?.[0]?.meta?.githubCommitSha?.slice(0, 7)} (Latest Preview: ${stgProj.latestDeployments?.[0]?.url})`);
    console.log(`  Prod Vercel:        ${prodProj.targets?.production?.meta?.githubCommitSha?.slice(0, 7)} (Target: ${prodProj.targets?.production?.url}) | ReadyState: ${prodProj.targets?.production?.readyState}`);
  } catch (e) {
    console.log('  Vercel audit error:', e.message);
  }

  // 2. SCHEMA TABLES & RPCS COMPARISON
  console.log('\n[3/6] SCHEMA JADVALLARI VA RPC FUNKSIYALARINI TAQQOSLASH:');
  const [stgOpenApi, prodOpenApi] = await Promise.all([
    fetchPostgrest(stagingUrl, stagingKeys.serviceRoleKey, ''),
    fetchPostgrest(prodUrl, prodEnv.SUPABASE_SERVICE_ROLE_KEY, '')
  ]);

  const stgTables = Object.keys(stgOpenApi.data?.definitions || {}).sort();
  const prodTables = Object.keys(prodOpenApi.data?.definitions || {}).sort();
  console.log(`  Staging Tables:     ${stgTables.length} ta`);
  console.log(`  Production Tables:  ${prodTables.length} ta`);

  const stgOnlyTables = stgTables.filter(t => !prodTables.includes(t));
  const prodOnlyTables = prodTables.filter(t => !stgTables.includes(t));
  if (stgOnlyTables.length === 0 && prodOnlyTables.length === 0) {
    console.log('  ✅ Jadvallar to\'liq mos: 100% SAME (0 ta farq)');
  } else {
    if (stgOnlyTables.length) console.log('  ⚠️ Staging only tables:', stgOnlyTables);
    if (prodOnlyTables.length) console.log('  ⚠️ Prod only tables:', prodOnlyTables);
  }

  const stgRpcs = Object.keys(stgOpenApi.data?.paths || {}).filter(p => p.startsWith('/rpc/')).map(p => p.replace('/rpc/', '')).sort();
  const prodRpcs = Object.keys(prodOpenApi.data?.paths || {}).filter(p => p.startsWith('/rpc/')).map(p => p.replace('/rpc/', '')).sort();
  console.log(`  Staging RPCs:       ${stgRpcs.length} ta`);
  console.log(`  Production RPCs:    ${prodRpcs.length} ta`);

  const stgOnlyRpcs = stgRpcs.filter(r => !prodRpcs.includes(r));
  const prodOnlyRpcs = prodRpcs.filter(r => !stgRpcs.includes(r));
  if (stgOnlyRpcs.length === 0 && prodOnlyRpcs.length === 0) {
    console.log('  ✅ RPC funksiyalar to\'liq mos: 100% SAME (0 ta farq)');
  } else {
    if (stgOnlyRpcs.length) console.log('  ⚠️ Staging only RPCs:', stgOnlyRpcs);
    if (prodOnlyRpcs.length) console.log('  ⚠️ Prod only RPCs:', prodOnlyRpcs);
  }

  // 3. STORAGE BUCKETS COMPARISON
  console.log('\n[4/6] STORAGE BUCKETLARINI TAQQOSLASH:');
  const [stgBuckets, prodBuckets] = await Promise.all([
    fetch(`${stagingUrl}/storage/v1/bucket`, { headers: { 'Authorization': `Bearer ${stagingKeys.serviceRoleKey}` } }).then(r => r.json()),
    fetch(`${prodUrl}/storage/v1/bucket`, { headers: { 'Authorization': `Bearer ${prodEnv.SUPABASE_SERVICE_ROLE_KEY}` } }).then(r => r.json())
  ]);

  console.log('  Staging Buckets:   ', Array.isArray(stgBuckets) ? stgBuckets.map(b => b.name) : stgBuckets);
  console.log('  Production Buckets:', Array.isArray(prodBuckets) ? prodBuckets.map(b => b.name) : prodBuckets);

  // 4. FORENSIC AUDIT OF F03/F04 ON STAGING
  console.log('\n[5/6] STAGING FORENSIC AUDIT (F03/F04 HUJJATLAR TAHLILI):');
  const targetDoc1 = 'STL-MGR-20261023-084AF4';
  const targetDoc2 = 'STL-REV-MGR-20261023-0BBEC4';

  const [settlement1, settlement2, mss1, mss2] = await Promise.all([
    fetchPostgrest(stagingUrl, stagingKeys.serviceRoleKey, `gold_settlements?document_number=in.(${targetDoc1},${targetDoc2})`),
    fetchPostgrest(stagingUrl, stagingKeys.serviceRoleKey, `manager_seller_settlements?document_number=in.(${targetDoc1},${targetDoc2})`),
    fetchPostgrest(stagingUrl, stagingKeys.serviceRoleKey, `gold_transactions?reference_id=in.(${targetDoc1},${targetDoc2})`),
    fetchPostgrest(stagingUrl, stagingKeys.serviceRoleKey, `audit_logs?entity_id=in.(${targetDoc1},${targetDoc2})`)
  ]);

  console.log(`  Hujjatlar topildi (gold_settlements): ${settlement1.data?.length || 0} ta`);
  (settlement1.data || []).forEach(d => {
    console.log(`   - [${d.document_number}] type: ${d.settlement_type}, status: ${d.status}, cash: ${d.cash_paid_amount} UZS (${d.cash_equivalent_grams} g), scrap: ${d.scrap_weight_grams} g (${d.scrap_585_equiv_grams} g 585), seller: ${d.seller_id}`);
  });

  console.log(`  Hujjatlar topildi (manager_seller_settlements): ${settlement2.data?.length || 0} ta`);
  (settlement2.data || []).forEach(d => {
    console.log(`   - [${d.document_number}] status: ${d.status}, cash: ${d.cash_amount} UZS, cash_585eq: ${d.cash_585_equiv_grams} g, scrap: ${d.scrap_grams} g, scrap_585eq: ${d.scrap_585_equiv_grams} g, total_585eq: ${d.total_585_equiv_grams} g`);
  });

  // Seller Dilshod accounts on Staging vs Prod
  const [stgSga, prodSga] = await Promise.all([
    fetchPostgrest(stagingUrl, stagingKeys.serviceRoleKey, 'seller_gold_accounts?select=seller_id,current_factory_obligation_grams,total_consigned_gold_grams,total_factory_settled_gold_grams,cash_balance_uzs,scrap_gold_balance_grams'),
    fetchPostgrest(prodUrl, prodEnv.SUPABASE_SERVICE_ROLE_KEY, 'seller_gold_accounts?select=seller_id,current_factory_obligation_grams,total_consigned_gold_grams,total_factory_settled_gold_grams,cash_balance_uzs,scrap_gold_balance_grams')
  ]);

  console.log('\n  Staging Seller Accounts:');
  (stgSga.data || []).forEach(s => {
    console.log(`   * Seller: ${s.seller_id} | Obligation: ${s.current_factory_obligation_grams} g | Consigned: ${s.total_consigned_gold_grams} g | Settled: ${s.total_factory_settled_gold_grams} g | Cash: ${s.cash_balance_uzs} UZS | Scrap: ${s.scrap_gold_balance_grams} g`);
  });

  console.log('\n  Production Seller Accounts:');
  console.log(`   * Jami yozuvlar: ${prodSga.data?.length || 0} ta (Toza: kutilgan 0)`);
  (prodSga.data || []).forEach(s => {
    console.log(`   * Seller: ${s.seller_id} | Obligation: ${s.current_factory_obligation_grams} g`);
  });

  // 5. PRODUCTION DATA COUNTS (ENSURE PRODUCTION IS UNTOUCHED)
  console.log('\n[6/6] PRODUCTION MA\'LUMOTLARINI TEKSHIRISH (UNTOUCHED INTEGRITY):');
  const [prodCust, prodSales, prodUsers] = await Promise.all([
    fetchPostgrest(prodUrl, prodEnv.SUPABASE_SERVICE_ROLE_KEY, 'customers?select=count'),
    fetchPostgrest(prodUrl, prodEnv.SUPABASE_SERVICE_ROLE_KEY, 'jewelry_sales?select=count'),
    fetch(`${prodUrl}/auth/v1/admin/users?page=1&per_page=10`, { headers: { 'Authorization': `Bearer ${prodEnv.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': prodEnv.SUPABASE_SERVICE_ROLE_KEY } }).then(r => r.json())
  ]);

  const custRange = prodCust.headers?.get('content-range') || '0/0';
  const salesRange = prodSales.headers?.get('content-range') || '0/0';
  const userList = Array.isArray(prodUsers.users) ? prodUsers.users : [];

  console.log(`  Production Customers:  ${custRange.split('/')[1] || 0} ta`);
  console.log(`  Production Sales:      ${salesRange.split('/')[1] || 0} ta`);
  console.log(`  Production Auth Users: ${userList.length} ta:`);
  userList.forEach(u => console.log(`   * User: ${u.email} (id: ${u.id}, role: ${u.role})`));

  console.log('\n==============================================================================');
  console.log('RECONCILIATION AUDIT COMPLETED (ALL OPERATIONS READ-ONLY)');
  console.log('==============================================================================');
}

runReconciliation().catch(console.error);
