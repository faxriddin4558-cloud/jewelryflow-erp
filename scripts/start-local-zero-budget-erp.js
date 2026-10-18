const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');
const { startStagingServer, stopStagingServer, TEST_USERS } = require('./isolated-staging-supabase-server');

const ENV_LOCAL_PATH = path.resolve(__dirname, '../.env.local');
const ENV_BACKUP_PATH = path.resolve(__dirname, '../.env.local.backup');

const OFFLINE_ENV_CONTENT = `# JEWELRYFLOW ERP — ZERO-BUDGET OFFLINE STANDALONE CONFIGURATION
# 100% Free, Local, No Cloud, No Paid APIs, No Docker Required
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=staging-anon-key-jewelryflow-2026
SUPABASE_SERVICE_ROLE_KEY=staging-service-role-key-jewelryflow-2026
NEXT_PUBLIC_APP_ENV=local_offline
`;

function killProcessTree(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {}
}

async function main() {
  console.log('======================================================================');
  console.log('JEWELRYFLOW ERP — ZERO-BUDGET STANDALONE OFFLINE ENVIRONMENT');
  console.log('Stack: Local PGlite (Real PostgreSQL WASM) + Next.js Full-Stack ERP');
  console.log('Zero Cloud Dependencies | Zero Costs | Zero Subscriptions | Zero Docker');
  console.log('======================================================================\n');

  let hadOriginalEnv = false;
  let nextProcess = null;

  const cleanup = async () => {
    console.log('\n[SHUTDOWN] To\'xtatish jarayoni boshlandi...');
    if (nextProcess && nextProcess.pid) {
      console.log('[SHUTDOWN] Next.js server to\'xtatilmoqda...');
      killProcessTree(nextProcess.pid);
    }
    console.log('[SHUTDOWN] Lokal PGlite bazasi to\'xtatilmoqda...');
    await stopStagingServer();

    if (hadOriginalEnv && fs.existsSync(ENV_BACKUP_PATH)) {
      try {
        if (fs.existsSync(ENV_LOCAL_PATH)) {
          if (process.platform === 'win32') {
            try { execSync(`attrib -H "${ENV_LOCAL_PATH}"`, { stdio: 'ignore' }); } catch {}
          }
          fs.unlinkSync(ENV_LOCAL_PATH);
        }
        fs.copyFileSync(ENV_BACKUP_PATH, ENV_LOCAL_PATH);
        fs.unlinkSync(ENV_BACKUP_PATH);
        if (process.platform === 'win32') {
          try { execSync(`attrib +H "${ENV_LOCAL_PATH}"`, { stdio: 'ignore' }); } catch {}
        }
        console.log('[XAVFSIZLIK] Asl .env.local fayli qayta tiklandi.');
      } catch (err) {
        console.error('[OGOHLANTIRISH] .env.local qayta tiklanmadi:', err.message);
      }
    } else if (fs.existsSync(ENV_LOCAL_PATH)) {
      try {
        if (process.platform === 'win32') {
          try { execSync(`attrib -H "${ENV_LOCAL_PATH}"`, { stdio: 'ignore' }); } catch {}
        }
        fs.unlinkSync(ENV_LOCAL_PATH);
      } catch {}
      console.log('[XAVFSIZLIK] Vaqtinchalik offline sozlamalari tozalandi.');
    }
    console.log('[TUGATILDI] Tizim toza holatda to\'xtatildi.\n');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    // 1. Safety backup of .env.local
    if (fs.existsSync(ENV_LOCAL_PATH)) {
      hadOriginalEnv = true;
      fs.copyFileSync(ENV_LOCAL_PATH, ENV_BACKUP_PATH);
      console.log('[XAVFSIZLIK] Mavjud .env.local fayli .env.local.backup sifatida saqlandi.');
      try {
        if (process.platform === 'win32') {
          execSync(`attrib -H "${ENV_LOCAL_PATH}"`, { stdio: 'ignore' });
        }
        fs.unlinkSync(ENV_LOCAL_PATH);
      } catch {}
    }

    // 2. Write offline local .env.local
    fs.writeFileSync(ENV_LOCAL_PATH, OFFLINE_ENV_CONTENT, 'utf8');
    console.log('[BOSHLAQICH] Lokal sozlamalar http://127.0.0.1:54321 ga yo\'naltirildi.');

    // 3. Boot PGlite backend server
    console.log('[MA\'LUMOTLAR BAZASI] Real PostgreSQL WASM dvigateli ishga tushirilmoqda (port 54321)...');
    await startStagingServer(54321);
    console.log('[MA\'LUMOTLAR BAZASI] Barcha 25 ta migratsiya va Goldia zavodi test xodimlari tayyor.');

    // 4. Print credentials table
    console.log('\n----------------------------------------------------------------------');
    console.log('DIQQAT: [DEMO / NOT PRODUCTION] OFFLINE EMULATED ENVIRONMENT');
    console.log('Bu muhit faqat Goldia zavodi lokal pilot sinovlari uchun mo\'ljallangan.');
    console.log('Ma\'lumotlar bazasi fayllari .local-pilot-data/db da saqlanadi va server o\'chirilganda ham o\'chib ketmaydi.');
    console.log('Zaxira nusxa yaratish: npm run db:backup | Tiklash: npm run db:restore');
    console.log('----------------------------------------------------------------------');
    console.log('GOLDIA ZAVODI PILOTI UCHUN TAYYOR DEMO AKKAUNTLAR:');
    console.log('----------------------------------------------------------------------');
    for (const u of TEST_USERS) {
      console.log(`  * ${u.full_name.padEnd(28)} | ${u.email.padEnd(24)} | Rol: ${u.role}`);
    }
    console.log(`  Umumiy Parol: GoldiaPassword2026! (FAQAT LOKAL EMULATORDA ISHLAYDI)`);
    console.log('----------------------------------------------------------------------\n');

    // 5. Start Next.js development server
    console.log('[NEXT.JS] ERP interfeysi http://localhost:3000 da ishga tushirilmoqda...');
    nextProcess = spawn('npx', ['next', 'dev', '-p', '3000'], {
      cwd: path.resolve(__dirname, '..'),
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }
    });

    nextProcess.on('close', (code) => {
      console.log(`[NEXT.JS] Dastur to'xtadi (kod: ${code})`);
      cleanup();
    });
  } catch (err) {
    console.error('[XATOLIK] Offline ERP ishga tushirishda xatolik:', err);
    await cleanup();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
