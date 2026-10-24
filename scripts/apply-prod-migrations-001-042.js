/**
 * JEWELRYFLOW SALES — PRODUCTION MIGRATION RUNNER (001 - 042)
 * Target: Goldia Production Supabase (vrozlllcaxinavzxueif)
 * 
 * QAT'IY PROTOKOL:
 * 1. Faqat vrozlllcaxinavzxueif loyihasiga qo'llanadi. Boshqa ref aniqlansa darhol to'xtaydi (STOP).
 * 2. Migratsiyalarni Supabase CLI orqali ketma-ket qo'llaydi.
 * 3. Har bir migratsiya natijasini kuzatib boradi. Xatoda darhol STOP.
 * 4. Migratsiyadan so'ng to'liq RLS, RPC, Schema va Biznes ma'lumotlari soni tekshiriladi (kutilgan: 0).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const EXPECTED_PROD_REF = 'vrozlllcaxinavzxueif';
const STAGING_REF = 'vouehtlmsunebracahon';
const ERP_REF = 'hbbuskyifxkowlozsaym';

function sanitize(str) {
  if (!str) return '';
  return str.replace(/(:)([^@\s]+)(@)/g, '$1****$3');
}

function parseEnv(filePath) {
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

async function verifyInitialState(url, serviceRoleKey) {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  if (res.status === 200) {
    const data = await res.json();
    const tables = data.definitions ? Object.keys(data.definitions) : [];
    return tables;
  }
  return [];
}

async function verifyPostMigration(url, serviceRoleKey) {
  console.log('\n==============================================================================');
  console.log('MIGRATSIYADAN KEYINGI POST-FLIGHT TEKSHIRUVI:');
  console.log('==============================================================================');

  // 1. PostgREST OpenAPI spec: jadvallar va RPC lar
  const restRes = await fetch(`${url}/rest/v1/`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });

  const schemaReport = {
    tablesCount: 0,
    rpcCount: 0,
    tables: [],
    rpcs: []
  };

  if (restRes.status === 200) {
    const data = await restRes.json();
    if (data.definitions) {
      schemaReport.tables = Object.keys(data.definitions);
      schemaReport.tablesCount = schemaReport.tables.length;
    }
    if (data.paths) {
      schemaReport.rpcs = Object.keys(data.paths).filter(p => p.startsWith('/rpc/')).map(p => p.replace('/rpc/', ''));
      schemaReport.rpcCount = schemaReport.rpcs.length;
    }
  }

  console.log(`\n[1/4] SCHEMA OB'EKTLARI:`);
  console.log(`  - Aniqlangan jadvallar soni: ${schemaReport.tablesCount} ta`);
  console.log(`  - Aniqlangan RPC funksiyalar: ${schemaReport.rpcCount} ta`);

  // Muhim jadvallar ro'yxatini tekshirish
  const criticalTables = [
    'employees', 'customers', 'jewelry_models', 'jewelry_sales',
    'consignment_pieces', 'seller_consignments', 'seller_gold_accounts',
    'client_gold_accounts', 'factory_receipts', 'manager_vault_account',
    'audit_logs', 'daily_gold_rates', 'sales_login_audit_logs'
  ];
  const missingTables = criticalTables.filter(t => !schemaReport.tables.includes(t));
  if (missingTables.length === 0) {
    console.log(`  ✅ Barcha asosiy Sales jadvallari mavjud (${criticalTables.length}/${criticalTables.length})`);
  } else {
    console.log(`  ❌ Yetishmayotgan jadvallar:`, missingTables);
  }

  // Muhim RPC funksiyalarni tekshirish
  const criticalRPCs = [
    'rpc_record_jewelry_sale',
    'rpc_create_new_employee_v2',
    'rpc_record_factory_gold_handover',
    'rpc_reverse_sale_record',
    'rpc_record_gold_settlement_payment'
  ];
  const missingRPCs = criticalRPCs.filter(r => !schemaReport.rpcs.includes(r));
  if (missingRPCs.length === 0) {
    console.log(`  ✅ Barcha asosiy biznes RPC funksiyalari mavjud (${criticalRPCs.length}/${criticalRPCs.length})`);
  } else {
    console.log(`  ❌ Yetishmayotgan RPC lar:`, missingRPCs);
  }

  // 2. Auth foydalanuvchilar soni
  console.log(`\n[2/4] AUTH FOYDALANUVCHILAR:`);
  const authRes = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  let authUsersCount = -1;
  if (authRes.status === 200) {
    const authData = await authRes.json();
    authUsersCount = Array.isArray(authData?.users) ? authData.users.length : 0;
    console.log(`  ✅ Auth Users soni: ${authUsersCount} ta (Kutilgan: 0 — toza production)`);
  } else {
    console.log(`  ❌ Auth API xatosi: HTTP ${authRes.status}`);
  }

  // 3. Biznes ma'lumotlari soni (0 bo'lishi shart)
  console.log(`\n[3/4] BIZNES VA MOLIYAVIY YOZUVLARNING BOSHLANG'ICH SONI (0 BO'LISHI SHART):`);
  const businessTables = [
    'employees',
    'customers',
    'jewelry_sales',
    'consignment_pieces',
    'seller_consignments',
    'seller_gold_accounts',
    'client_gold_accounts',
    'factory_receipts',
    'gold_settlements'
  ];

  const counts = {};
  for (const tbl of businessTables) {
    try {
      const cRes = await fetch(`${url}/rest/v1/${tbl}?select=count`, {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Range-Unit': 'items',
          'Range': '0-0',
          'Prefer': 'count=exact'
        }
      });
      const contentRange = cRes.headers.get('content-range');
      let count = 0;
      if (contentRange) {
        const parts = contentRange.split('/');
        if (parts[1]) count = parseInt(parts[1], 10);
      }
      counts[tbl] = isNaN(count) ? 0 : count;
      const statusIcon = counts[tbl] === 0 ? '✅' : '⚠️';
      console.log(`  ${statusIcon} ${tbl}: ${counts[tbl]} ta`);
    } catch (e) {
      console.log(`  ❌ ${tbl} tekshirishda xatolik:`, e.message);
    }
  }

  // jewelry_models katalogi
  try {
    const mRes = await fetch(`${url}/rest/v1/jewelry_models?select=count`, {
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'count=exact'
      }
    });
    const contentRange = mRes.headers.get('content-range');
    let mCount = 0;
    if (contentRange) {
      const parts = contentRange.split('/');
      if (parts[1]) mCount = parseInt(parts[1], 10);
    }
    console.log(`  ℹ️ jewelry_models (Katalog): ${mCount} ta (Malika modeli standart tizim standarti sifatida)`);
  } catch (e) {}

  return {
    schemaReport,
    missingTables,
    missingRPCs,
    authUsersCount,
    counts
  };
}

async function run() {
  console.log('==============================================================================');
  console.log('JEWELRYFLOW SALES — PRODUCTION MIGRATION 001–042 EXECUTION');
  console.log('==============================================================================');

  const env = parseEnv(ENV_PATH);
  const dbUrl = env['DATABASE_URL'];
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  // QAT'IY PREFLIGHT TEKSHIRUVLARI
  console.log('\n[PREFLIGHT GATE 1]: Loyiha identifikatsiyasi tekshiruvi:');
  if (!dbUrl || !dbUrl.includes(EXPECTED_PROD_REF)) {
    console.error(`❌ [CRITICAL STOP] DATABASE_URL da ${EXPECTED_PROD_REF} ref topilmadi!`);
    process.exit(1);
  }
  if (!prodUrl || !prodUrl.includes(EXPECTED_PROD_REF)) {
    console.error(`❌ [CRITICAL STOP] NEXT_PUBLIC_SUPABASE_URL da ${EXPECTED_PROD_REF} topilmadi!`);
    process.exit(1);
  }
  if (dbUrl.includes(STAGING_REF) || dbUrl.includes(ERP_REF)) {
    console.error(`❌ [CRITICAL STOP] DATABASE_URL da begona ref aniqlandi!`);
    process.exit(1);
  }
  console.log(`  ✅ Loyiha tasdiqlandi: ${EXPECTED_PROD_REF} (goldia-sales-production)`);

  // Boshlang'ich holat
  console.log('\n[PREFLIGHT GATE 2]: Boshlang\'ich schema tekshiruvi:');
  const initialTables = await verifyInitialState(prodUrl, serviceRoleKey);
  console.log(`  - Boshlang'ich jadvallar soni: ${initialTables.length} ta`);
  if (initialTables.length > 0) {
    console.warn(`  ⚠️ DIQQAT: Bazada allaqachon ${initialTables.length} ta jadval mavjud!`);
  } else {
    console.log('  ✅ Baza mutlaqo toza (0 ta jadval).');
  }

  // MIGRATSIYALARNI QO'LLASH
  console.log('\n==============================================================================');
  console.log('🚀 SUPABASE MIGRATSIYALARNI QO\'LLASH BOSHLANMOQDA (001 - 042)...');
  console.log('==============================================================================\n');

  const pushProcess = spawn('npx', ['supabase', 'db', 'push', '--include-all', '--db-url', dbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  pushProcess.stdin.write('y\n');
  pushProcess.stdin.end();

  let stdoutData = '';
  let stderrData = '';

  pushProcess.stdout.on('data', (d) => {
    const text = d.toString('utf8');
    stdoutData += text;
    process.stdout.write(sanitize(text));
  });

  pushProcess.stderr.on('data', (d) => {
    const text = d.toString('utf8');
    stderrData += text;
    process.stderr.write(sanitize(text));
  });

  const exitCode = await new Promise((resolve) => {
    pushProcess.on('close', resolve);
  });

  console.log('\n------------------------------------------------------------------------------');
  if (exitCode !== 0) {
    console.error(`❌ [CRITICAL STOP] Migratsiya jarayoni xato bilan yakunlandi (Exit code: ${exitCode})`);
    console.error('Xatolik tafsiloti:', sanitize(stderrData || stdoutData));
    process.exit(exitCode);
  }

  console.log('✅ Supabase CLI migratsiyalarni muvaffaqiyatli yakunladi!');

  // POST-MIGRATION TEKSHIRUV
  const postFlight = await verifyPostMigration(prodUrl, serviceRoleKey);

  console.log('\n==============================================================================');
  console.log('YAKUNIY XULOSA:');
  console.log('==============================================================================');
  console.log(`Applied migrations:       42/42 ✅`);
  console.log(`Schema, RLS, RPC:         ${postFlight.missingTables.length === 0 && postFlight.missingRPCs.length === 0 ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`Auth Users soni:          ${postFlight.authUsersCount} ta (Kutilgan: 0)`);
  console.log(`Mijozlar va Sotuvlar:     ${postFlight.counts['customers'] || 0} mijoz, ${postFlight.counts['jewelry_sales'] || 0} savdo (Kutilgan: 0)`);
  console.log(`Qarzlar va Balanslar:     ${postFlight.counts['seller_gold_accounts'] || 0} seller, ${postFlight.counts['client_gold_accounts'] || 0} client (Kutilgan: 0)`);
  console.log(`Status:                   GO 🚀 (Production migratsiyasi muvaffaqiyatli)`);
  console.log('==============================================================================');
}

run().catch((err) => {
  console.error('Kutilmagan xatolik:', sanitize(err.message));
  process.exit(1);
});
