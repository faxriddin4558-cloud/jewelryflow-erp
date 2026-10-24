/**
 * JEWELRYFLOW SALES — GOLDIA PRODUCTION READ-ONLY HANDSHAKE TEST
 * 
 * Ushbu skript .env.production.local faylidagi kalitlarni tekshiradi:
 * 1. Git ignore holati
 * 2. Supabase Anon Key (Read-only Auth Settings)
 * 3. Supabase Service Role Key (Read-only Admin Users ping)
 * 4. DATABASE_URL (Port 5432 tekshiruvi va xavfsiz read-only migration list)
 * 
 * XAVFSIZLIK:
 * - Hech qanday kalit, token yoki parol konsolga yoki faylga chiqarilmaydi (sanitized).
 * - Hech qanday SQL yozish, migration, alter yoki insert bajarilmaydi (faqat read-only).
 */

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const net = require('net');
const { execSync } = require('child_process');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');

function loadEnvConfig() {
  const config = {
    url: '',
    anonKey: '',
    serviceRoleKey: '',
    dbUrl: '',
    directUrl: ''
  };

  if (!fs.existsSync(ENV_PATH)) {
    return { config, exists: false };
  }

  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key === 'NEXT_PUBLIC_SUPABASE_URL') config.url = val;
      if (key === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') config.anonKey = val;
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') config.serviceRoleKey = val;
      if (key === 'DATABASE_URL') config.dbUrl = val;
      if (key === 'DIRECT_URL') config.directUrl = val;
    }
  }

  return { config, exists: true };
}

function maskSecret(val) {
  if (!val) return '❌ [BO\'SH / BIRIKTIRILMAGAN]';
  return `✅ [MAVJUD: ${val.length} belgi, xavfsiz yashirilgan]`;
}

function sanitizeError(errStr) {
  if (!errStr) return '';
  // Parol va connection stringlarni maskalash
  return errStr.replace(/(postgresql:\/\/|postgres:\/\/)([^:@\s]+):([^@\s]+)@/g, '$1$2:****@');
}

async function runHandshake() {
  console.log('==============================================================================');
  console.log('JEWELRYFLOW SALES — PRODUCTION READ-ONLY HANDSHAKE & PRE-FLIGHT TEST');
  console.log('==============================================================================');

  const { config, exists } = loadEnvConfig();

  // 1. Fayl mavjudligi va Git ignore holati
  console.log('\n[1/5] .env.production.local VA GIT IGNORE HOLATI:');
  if (!exists) {
    console.log('  ❌ XATOLIK: .env.production.local fayli topilmadi!');
    return;
  }
  console.log('  ✅ Fayl mavjud:', path.relative(process.cwd(), ENV_PATH));

  try {
    const gitCheck = execSync('git check-ignore -v .env.production.local', { encoding: 'utf8', cwd: path.resolve(__dirname, '..') });
    console.log(`  ✅ Git Ignore PASS: Fayl Git tomonidan to'liq e'tiborsiz qoldirilgan (${gitCheck.trim()})`);
  } catch (e) {
    console.log('  ⚠️ DIQQAT: git check-ignore tekshiruvi amalga oshmadi yoki fayl ignore qilinmagan!');
  }

  // 2. Maydonlar holati (Maskalangan)
  console.log('\n[2/5] SOZLAMALARNING MAVJUDLIGI:');
  console.log(`  - NEXT_PUBLIC_SUPABASE_URL:     ${config.url ? `✅ ${config.url}` : '❌ [BO\'SH]'}`);
  console.log(`  - NEXT_PUBLIC_SUPABASE_ANON_KEY: ${maskSecret(config.anonKey)}`);
  console.log(`  - SUPABASE_SERVICE_ROLE_KEY:     ${maskSecret(config.serviceRoleKey)}`);
  console.log(`  - DATABASE_URL:                  ${maskSecret(config.dbUrl)}`);

  const missingKeys = [];
  if (!config.anonKey) missingKeys.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!config.serviceRoleKey) missingKeys.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!config.dbUrl) missingKeys.push('DATABASE_URL');

  if (missingKeys.length > 0) {
    console.log('\n------------------------------------------------------------------------------');
    console.log(`⏳ KUTISH HOLATI: Quyidagi maydonlar hali .env.production.local ga kiritilmagan:`);
    missingKeys.forEach(k => console.log(`   * ${k}`));
    console.log('------------------------------------------------------------------------------');
    console.log('STATUS: PENDING_USER_INPUT (Kalitlar kiritilishi kutilmoqda)');
    return;
  }

  // 3. Anon Key Read-Only Test
  console.log('\n[3/5] SUPABASE ANON KEY (READ-ONLY) SINOVI:');
  try {
    const res = await fetch(`${config.url}/auth/v1/settings`, {
      headers: {
        'apikey': config.anonKey,
        'Authorization': `Bearer ${config.anonKey}`
      }
    });
    if (res.status === 200) {
      console.log('  ✅ Anon Key PASS: Supabase Auth serveri Anon Key bilan muvaffaqiyatli javob berdi (HTTP 200)');
    } else {
      console.log(`  ❌ Anon Key XATOLIK: HTTP ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.log(`  ❌ Anon Key ulanish xatosi: ${err.message}`);
  }

  // 4. Service Role Key Read-Only Test
  console.log('\n[4/5] SUPABASE SERVICE ROLE KEY (READ-ONLY ADMIN) SINOVI:');
  try {
    const res = await fetch(`${config.url}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: {
        'apikey': config.serviceRoleKey,
        'Authorization': `Bearer ${config.serviceRoleKey}`
      }
    });
    if (res.status === 200) {
      const data = await res.json();
      const userCount = Array.isArray(data?.users) ? data.users.length : 0;
      console.log(`  ✅ Service Role PASS: Supabase Admin Auth ruxsati tasdiqlandi (Mavjud auth foydalanuvchilar: ${userCount})`);
    } else {
      console.log(`  ❌ Service Role XATOLIK: HTTP ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.log(`  ❌ Service Role ulanish xatosi: ${err.message}`);
  }

  // 5. DATABASE_URL Tekshiruvi
  console.log('\n[5/5] DATABASE_URL (POSTGRESQL READ-ONLY HANDSHAKE):');
  let dbPort = 5432;
  let dbHost = '';
  try {
    const parsedUrl = new URL(config.dbUrl);
    dbPort = parseInt(parsedUrl.port || '5432', 10);
    dbHost = parsedUrl.hostname;
    console.log(`  - Aniqlangan Host: ${dbHost}`);
    console.log(`  - Aniqlangan Port: ${dbPort}`);

    if (dbPort === 6543) {
      console.log('  ❌ CRITICAL_ERROR: Port 6543 (Transaction Pooler) aniqlandi!');
      console.log('     Migratsiyalar uchun Transaction Pooler ishlatilishi taqiqlanadi.');
      console.log('     Iltimos, Supabase Dashboard -> Database -> Connection string bo\'limida "Session" (port 5432) ni tanlang.');
      return;
    } else if (dbPort === 5432) {
      console.log('  ✅ Port tekshiruvi: 5432 (Session pooler yoki Direct connection) — MIGRATSIYA UCHUN TO\'G\'RI TANLOV.');
    } else {
      console.log(`  ⚠️ Noma'lum port: ${dbPort}`);
    }

    // TCP Connectivity test
    console.log('  - TCP port ulanishini tekshirish...');
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: dbHost, port: dbPort, timeout: 5000 }, () => {
        console.log(`  ✅ TCP PASS: ${dbHost}:${dbPort} portiga muvaffaqiyatli ulanildi.`);
        socket.destroy();
        resolve();
      });
      socket.on('error', (e) => reject(new Error(`TCP ulanish xatosi: ${e.message}`)));
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('TCP ulanishda timeout yuz berdi (5s)'));
      });
    });

    // Supabase CLI migration list dry test
    console.log('  - Supabase CLI read-only migration status tekshiruvi...');
    try {
      const dryList = execSync(`npx supabase migration list --db-url "${config.dbUrl}"`, {
        encoding: 'utf8',
        cwd: path.resolve(__dirname, '..'),
        stdio: ['pipe', 'pipe', 'pipe']
      });
      console.log('  ✅ Database Handshake PASS: Baza bilan aloqa to\'liq o\'rnatildi!');
      console.log('\n  [Masofaviy migratsiya holati]:');
      // Faqat xavfsiz qatorlarni chiqaramiz
      dryList.split('\n').slice(0, 10).forEach(l => console.log('    ' + l));
    } catch (cliErr) {
      const cleaned = sanitizeError(cliErr.stderr || cliErr.message);
      console.log(`  ⚠️ Supabase CLI xabari: ${cleaned}`);
    }

  } catch (err) {
    console.log(`  ❌ DATABASE_URL tahlil xatosi: ${sanitizeError(err.message)}`);
  }

  console.log('\n==============================================================================');
  console.log('YAKUNIY XULOSA: Barcha ulanishlar tekshirildi.');
  console.log('==============================================================================');
}

runHandshake().catch((err) => {
  console.error('Kutilmagan xatolik:', sanitizeError(err.message));
});
