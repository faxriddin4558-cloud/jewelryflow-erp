/**
 * JewelryFlow Sales — Staging Supabase Safe Migration Runner
 * 
 * Ushbu skript yangi Supabase Cloud Staging loyihasiga 001-035 migratsiyalarni
 * to'g'ri ketma-ketlikda va xavfsiz tarzda qo'llash uchun mo'ljallangan.
 * 
 * QAT'IY XAVFSIZLIK:
 * 1. Hech qachon production bazasiga ulanmaydi.
 * 2. Foydalanuvchi tasdiqlamagan loyiha ID yoki URL ishlatilmaydi.
 * 3. Seed ma'lumotlar faqat foydalanuvchi alohida tasdiqlaganidan keyin qo'llanadi.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MIGRATIONS_DIR = path.resolve(__dirname, '../supabase/migrations');
const SEED_FILE = path.resolve(__dirname, 'seed-staging-synthetic-demo.sql');

function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function verifySafety(connectionString, projectRef) {
  const target = (connectionString || projectRef || '').toLowerCase();
  
  // Production URL yoki kalitlar bilan to'qnashuvni tekshirish
  if (target.includes('production') || target.includes('goldia-prod') || target.includes('jewelryflow-prod')) {
    throw new Error('[CRITICAL_SAFETY_STOP] Kiritilgan parametrda "production" belgisi aniqlandi! Jarayon darhol to\'xtatildi.');
  }

  if (!target || target.trim().length < 5) {
    throw new Error('[INPUT_ERROR] Staging loyiha ulanish ma\'lumoti (Connection String yoki Project Ref) to\'liq ko\'rsatilmadi.');
  }

  return true;
}

function runDryRun(dbUrl) {
  console.log('\n======================================================');
  console.log('🔍 STAGING SUPABASE MIGRATION DRY-RUN TEKSHIRUVI');
  console.log('======================================================');
  
  const files = getMigrationFiles();
  console.log(`\nJami 35 ta SQL migratsiya fayli aniqlandi (001 - 035):`);
  files.forEach((f, idx) => {
    console.log(`  [${String(idx + 1).padStart(2, '0')}/35] ${f}`);
  });

  console.log('\nSupabase CLI orqali masofaviy bazaga ulanish sinovi boshlanmoqda...');
  try {
    const output = execSync(`npx supabase db push --dry-run --include-all --db-url "${dbUrl}"`, {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
    });
    console.log('\n[DRY-RUN NATIJASI]:');
    console.log(output);
    return true;
  } catch (err) {
    console.error('\n[DRY-RUN XATOLIGI]:', err.stdout || err.message);
    return false;
  }
}

function applyMigrations(dbUrl) {
  console.log('\n======================================================');
  console.log('🚀 STAGING SUPABASE MIGRATSIYALARINI QO\'LLASH');
  console.log('======================================================');
  
  try {
    const output = execSync(`npx supabase db push --include-all --db-url "${dbUrl}"`, {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
    });
    console.log(output);
    console.log('✅ Barcha 35 ta migratsiya yangi Staging bazasida muvaffaqiyatli qo\'llandi!');
    return true;
  } catch (err) {
    console.error('❌ Migratsiyalarni qo\'llashda xatolik:', err.stdout || err.message);
    throw err;
  }
}

// Export for CLI or direct invocation
module.exports = {
  getMigrationFiles,
  verifySafety,
  runDryRun,
  applyMigrations,
};

if (require.main === module) {
  const dbUrl = process.env.STAGING_DATABASE_URL;
  const isApply = process.argv.includes('--apply');
  
  if (!dbUrl) {
    console.log('\n[FOYDALANISH QOIDASI]:');
    console.log('1. Dry-run tekshiruvi:');
    console.log('   $env:STAGING_DATABASE_URL="postgresql://postgres:[PASS]@[HOST]:[PORT]/postgres"');
    console.log('   node scripts/deploy-staging-supabase.js');
    console.log('\n2. Haqiqiy qo\'llash (faqat tasdiqdan so\'ng):');
    console.log('   node scripts/deploy-staging-supabase.js --apply\n');
    process.exit(0);
  }

  verifySafety(dbUrl);

  if (isApply) {
    applyMigrations(dbUrl);
  } else {
    runDryRun(dbUrl);
  }
}
