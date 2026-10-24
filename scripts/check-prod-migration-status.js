const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const EXPECTED_PROD_REF = 'vrozlllcaxinavzxueif';

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

const env = parseEnv(ENV_PATH);
const dbUrl = env['DATABASE_URL'];
const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!dbUrl || !dbUrl.includes(EXPECTED_PROD_REF)) {
  console.error(`ERROR: DATABASE_URL does not contain expected prod ref ${EXPECTED_PROD_REF}`);
  process.exit(1);
}

console.log('Production URL:', prodUrl);
console.log('Target Ref confirmed:', EXPECTED_PROD_REF);

const listRes = spawnSync('npx', ['supabase', 'migration', 'list', '--db-url', dbUrl], {
  cwd: path.resolve(__dirname, '..'),
  shell: true,
  encoding: 'utf8'
});

console.log('Migration list stdout:');
console.log(listRes.stdout || '(no stdout)');
if (listRes.stderr) {
  console.log('Migration list stderr:');
  console.log(listRes.stderr);
}
