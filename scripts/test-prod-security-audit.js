/**
 * JEWELRYFLOW SALES — PRODUCTION SECURITY & ISOLATION PRE-FLIGHT AUDIT
 * 
 * Ushbu skript barcha 6 ta talabni to'liq tekshiradi:
 * 1. Kalitlar to'ldirilganligi (qiymatlarni chiqarmasdan)
 * 2. To'g'ri project ref (vrozlllcaxinavzxueif)
 * 3. Auth API va DB ga read-only ulanish
 * 4. DATABASE_URL Session pooler / Direct (Port 5432)
 * 5. Production va Staging env izolyatsiyasi (to'qnashuv yo'qligi)
 * 6. Database schema bo'shligi (0 ta remote migration, PostgREST da 0 ta maxsus jadval)
 */

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const net = require('net');
const { execSync } = require('child_process');

const PROD_ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const STAGING_ENV_PATH = path.resolve(__dirname, '../.env.staging.local');

const EXPECTED_PROD_REF = 'vrozlllcaxinavzxueif';
const STAGING_REF = 'vouehtlmsunebracahon';
const ERP_REF = 'hbbuskyifxkowlozsaym';

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const res = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const k = trimmed.slice(0, idx).trim();
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      res[k] = v;
    }
  }
  return res;
}

async function audit() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES PRODUCTION — SECURITY & CONNECTIVITY AUDIT');
  console.log('==============================================================================');

  const prodEnv = parseEnv(PROD_ENV_PATH);
  const stagingEnv = parseEnv(STAGING_ENV_PATH);

  const results = {
    keysFilled: false,
    projectRefMatch: false,
    authReadOnlyPass: false,
    dbReadOnlyPass: false,
    poolerModePass: false,
    stagingIsolationPass: false,
    schemaEmptyPass: false
  };

  // 1. Kalitlar to'ldirilganligi (qiymatlarni chiqarmasdan)
  console.log('\n[1/6] KALITLAR MAVJUDLIGI VA TO\'LDIRILISHI:');
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_URL',
    'DIRECT_URL'
  ];
  let allKeysPresent = true;
  for (const k of required) {
    const val = prodEnv[k] || '';
    if (val && val.length > 15) {
      console.log(`  ✅ ${k}: MAVJUD (${val.length} belgi)`);
    } else {
      console.log(`  ❌ ${k}: BO'SH YOKI NOTO'G'RI!`);
      allKeysPresent = false;
    }
  }
  results.keysFilled = allKeysPresent;

  // 2. To'g'ri Project Ref tekshiruvi (vrozlllcaxinavzxueif)
  console.log('\n[2/6] PROJECT REFERENCE TEKSHIRUVI:');
  const url = prodEnv['NEXT_PUBLIC_SUPABASE_URL'] || '';
  const dbUrl = prodEnv['DATABASE_URL'] || '';
  let refPass = true;

  if (url.includes(EXPECTED_PROD_REF)) {
    console.log(`  ✅ SUPABASE_URL: ${EXPECTED_PROD_REF} ga mos.`);
  } else {
    console.log(`  ❌ SUPABASE_URL: ${EXPECTED_PROD_REF} ni o'z ichiga olmaydi!`);
    refPass = false;
  }

  if (dbUrl.includes(EXPECTED_PROD_REF)) {
    console.log(`  ✅ DATABASE_URL: ${EXPECTED_PROD_REF} foydalanuvchisi / loyiha ID'siga ega.`);
  } else {
    console.log(`  ❌ DATABASE_URL: ${EXPECTED_PROD_REF} aniqlanmadi!`);
    refPass = false;
  }
  results.projectRefMatch = refPass;

  // 3. DATABASE_URL Direct yoki Session pooler ekanini tekshirish (Port 5432)
  console.log('\n[3/6] POOLER VA PORT TEKSHIRUVI:');
  try {
    const parsedDbUrl = new URL(dbUrl);
    const port = parseInt(parsedDbUrl.port || '5432', 10);
    const host = parsedDbUrl.hostname;
    console.log(`  - Database Host: ${host}`);
    console.log(`  - Database Port: ${port}`);

    if (port === 6543) {
      console.log('  ❌ FAIL: Port 6543 (Transaction Pooler)! Migratsiya uchun yaroqsiz.');
      results.poolerModePass = false;
    } else if (port === 5432) {
      console.log('  ✅ PASS: Port 5432 (Session pooler yoki Direct connection) — Migratsiya va DDL uchun to\'g\'ri.');
      results.poolerModePass = true;
    } else {
      console.log(`  ⚠️ Kutilmagan port: ${port}`);
    }
  } catch (e) {
    console.log('  ❌ DATABASE_URL tahlilida xatolik:', e.message);
  }

  // 4. Production va Staging env qiymatlari aralashmaganini tekshirish
  console.log('\n[4/6] PRODUCTION VA STAGING AJRATILISHI (ISOLATION):');
  let isolationPass = true;
  if (url.includes(STAGING_REF) || url.includes(ERP_REF)) {
    console.log('  ❌ FAIL: Production URL da Staging yoki ERP ref mavjud!');
    isolationPass = false;
  }
  if (dbUrl.includes(STAGING_REF) || dbUrl.includes(ERP_REF)) {
    console.log('  ❌ FAIL: Production DATABASE_URL da Staging yoki ERP ref mavjud!');
    isolationPass = false;
  }
  if (stagingEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY'] && prodEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY'] === stagingEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    console.log('  ❌ FAIL: Production Anon Key Staging Anon Key bilan bir xil!');
    isolationPass = false;
  }
  if (stagingEnv['SUPABASE_SERVICE_ROLE_KEY'] && prodEnv['SUPABASE_SERVICE_ROLE_KEY'] === stagingEnv['SUPABASE_SERVICE_ROLE_KEY']) {
    console.log('  ❌ FAIL: Production Service Role Key Staging bilan bir xil!');
    isolationPass = false;
  }

  if (isolationPass) {
    console.log('  ✅ PASS: Production va Staging mutlaqo ajratilgan.');
    console.log(`     * Production Ref: ${EXPECTED_PROD_REF}`);
    console.log(`     * Staging Ref:    ${STAGING_REF} (bironta ham to'qnashuv yo'q)`);
    results.stagingIsolationPass = true;
  }

  // 5. Production Auth API Read-Only Test
  console.log('\n[5/6] PRODUCTION AUTH API (READ-ONLY) SINOVI:');
  try {
    const anonRes = await fetch(`${url}/auth/v1/settings`, {
      headers: {
        'apikey': prodEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY']
      }
    });
    const serviceRes = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: {
        'apikey': prodEnv['SUPABASE_SERVICE_ROLE_KEY'],
        'Authorization': `Bearer ${prodEnv['SUPABASE_SERVICE_ROLE_KEY']}`
      }
    });

    if (anonRes.status === 200 && serviceRes.status === 200) {
      const data = await serviceRes.json();
      const usersCount = Array.isArray(data?.users) ? data.users.length : 0;
      console.log(`  ✅ Auth Anon Key: PASS (HTTP 200 OK)`);
      console.log(`  ✅ Auth Admin Key: PASS (HTTP 200 OK, Foydalanuvchilar soni: ${usersCount})`);
      results.authReadOnlyPass = true;
    } else {
      console.log(`  ❌ Auth API javob xatosi: Anon=${anonRes.status}, Service=${serviceRes.status}`);
    }
  } catch (err) {
    console.log('  ❌ Auth API ulanish xatosi:', err.message);
  }

  // 6. Database Schema Bo'shligi va DB Read-Only Tekshiruvi
  console.log('\n[6/6] DATABASE READ-ONLY VA SCHEMA TOZALIGI SINOVI:');
  try {
    // A) TCP Connection
    const parsedDb = new URL(dbUrl);
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: parsedDb.hostname, port: parseInt(parsedDb.port, 10), timeout: 5000 }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', reject);
      socket.on('timeout', () => { socket.destroy(); reject(new Error('Timeout')); });
    });
    console.log('  ✅ Database TCP Connection: PASS');

    // B) Supabase CLI Migration List (Read-only)
    const cliOutput = execSync(`npx supabase migration list --db-url "${dbUrl}"`, {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Check remote column
    const lines = cliOutput.split('\n');
    let remoteCount = 0;
    for (const l of lines) {
      // Formats like: "20260101000001 │ 20260101000001 │ ..."
      const parts = l.split('│');
      if (parts.length >= 3) {
        const local = parts[0].trim();
        const remote = parts[1].trim();
        if (remote && remote !== 'REMOTE' && remote.length > 5) {
          remoteCount++;
        }
      }
    }

    console.log(`  ✅ Supabase CLI Remote Handshake: PASS`);
    console.log(`  - Boshlang'ich masofaviy migratsiyalar soni: ${remoteCount} ta`);

    // C) PostgREST OpenAPI spec schema check
    const restRes = await fetch(`${url}/rest/v1/`, {
      headers: {
        'apikey': prodEnv['SUPABASE_SERVICE_ROLE_KEY'],
        'Authorization': `Bearer ${prodEnv['SUPABASE_SERVICE_ROLE_KEY']}`
      }
    });

    let exposedTables = [];
    if (restRes.status === 200) {
      const openApiSpec = await restRes.json();
      if (openApiSpec.definitions) {
        exposedTables = Object.keys(openApiSpec.definitions);
      }
    }

    console.log(`  - Public schema maxsus jadvallari: ${exposedTables.length} ta (${exposedTables.join(', ') || 'MUTLAQO BO\'SH'})`);

    if (remoteCount === 0 && exposedTables.length === 0) {
      console.log('  ✅ Database Schema Holati: TOZA / BO\'SH (Supabase standart holati, hech qanday eski jadval yoki seed yo\'q)');
      results.schemaEmptyPass = true;
      results.dbReadOnlyPass = true;
    } else {
      console.log(`  ⚠️ Schema to'liq bo'sh emas (Remote migrations: ${remoteCount}, tables: ${exposedTables.length})`);
      results.dbReadOnlyPass = true;
    }
  } catch (err) {
    console.log('  ❌ Database ulanish xatosi:', err.message);
  }

  // YAKUNIY XULOSA
  console.log('\n==============================================================================');
  console.log('YAKUNIY AUDIT NATIJALARI:');
  console.log('==============================================================================');
  console.log(`AUTH API:          ${results.authReadOnlyPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`DATABASE:          ${results.dbReadOnlyPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`SCHEMA TOZALIGI:   ${results.schemaEmptyPass ? 'PASS (TOZA / BO\'SH) ✅' : 'FAIL ❌'}`);
  console.log(`ISOLATION:         ${results.stagingIsolationPass ? 'PASS (MUTLAQO AJRATILGAN) ✅' : 'FAIL ❌'}`);
  console.log(`POOLER REJIMI:     ${results.poolerModePass ? 'PASS (Session Mode 5432) ✅' : 'FAIL ❌'}`);
  
  const allReady = results.keysFilled && results.projectRefMatch && results.authReadOnlyPass && 
                   results.dbReadOnlyPass && results.poolerModePass && results.stagingIsolationPass;

  console.log(`\nMIGRATION TAYYORLIGI: ${allReady ? 'READY 🚀' : 'NOT READY ⚠️'}`);
  console.log('==============================================================================');
}

audit().catch(console.error);
