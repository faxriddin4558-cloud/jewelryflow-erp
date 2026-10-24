const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const MIGRATIONS_DIR = path.resolve(__dirname, '../supabase/migrations');

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

function main() {
  console.log('==============================================================================');
  console.log('JEWELRYFLOW SALES — PRODUCTION MIGRATION DRY-RUN AUDIT');
  console.log('==============================================================================');

  const env = parseEnv(ENV_PATH);
  const dbUrl = env['DATABASE_URL'];
  const expectedRef = 'vrozlllcaxinavzxueif';

  if (!dbUrl || !dbUrl.includes(expectedRef)) {
    console.error(`❌ [STOP] DATABASE_URL noto'g'ri yoki ${expectedRef} ref mavjud emas!`);
    process.exit(1);
  }

  // 1. Files & Checksums
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  console.log(`\nJami migratsiya fayllari: ${files.length} ta (001 - 042)\n`);

  files.forEach((f, idx) => {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f));
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    console.log(`  [${String(idx + 1).padStart(2, '0')}/42] ${f} (sha256: ${hash})`);
  });

  // 2. Supabase CLI Dry-Run
  console.log('\n------------------------------------------------------------------------------');
  console.log('Supabase CLI `db push --dry-run` tekshiruvi:');
  console.log('------------------------------------------------------------------------------');

  try {
    const out = execSync(`npx supabase db push --dry-run --db-url "${dbUrl}"`, {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(sanitize(out));
    console.log('✅ DRY-RUN PASS: Barcha migratsiyalar xatosiz aniqlandi.');
  } catch (err) {
    console.error('❌ DRY-RUN XATOLIK:');
    console.error(sanitize(err.stderr || err.message));
    process.exit(1);
  }
}

main();
