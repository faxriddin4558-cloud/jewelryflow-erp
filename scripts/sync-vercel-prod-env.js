const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const PROJECT_ID = 'prj_f6tNMpNFUErZgiURjTyaAu3M70VB';
const TEAM_ID = 'team_GPJgf92gZPMLY35ES6gHd4mG';

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
  const env = parseEnv(ENV_PATH);
  const keysToSync = [
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_URL',
    'DIRECT_URL'
  ];

  console.log(`Setting up ${keysToSync.length} production environment variables in Vercel project ${PROJECT_ID}...`);

  for (const k of keysToSync) {
    const val = env[k];
    if (!val) {
      console.warn(`⚠️ Warning: ${k} is empty in .env.production.local`);
      continue;
    }

    const payload = JSON.stringify({
      key: k,
      value: val,
      type: k.includes('KEY') || k.includes('URL') ? 'encrypted' : 'plain',
      target: ['production']
    });

    const tmpFile = path.resolve(__dirname, `tmp_${Date.now()}_payload.json`);
    try {
      fs.writeFileSync(tmpFile, payload, 'utf8');
      const res = execSync(`npx vercel api /v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID} -X POST --input "${tmpFile}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const parsed = JSON.parse(res);
      if (parsed.created) {
        console.log(`  ✅ Added: ${k} (target: production, type: ${parsed.created.type})`);
      } else {
        console.log(`  ℹ️ Result for ${k}:`, res.trim());
      }
    } catch (e) {
      console.error(`  ❌ Failed to add ${k}:`, e.stderr || e.message);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }
  console.log('Production environment variables synchronization finished.');
}

main();
