const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function check() {
  console.log('==============================================================================');
  console.log('AUDITING HISTORICALLY COMMITTED SERVICE_ROLE KEY STATUS');
  console.log('Rule: Zero secret printing - only reporting active vs revoked status');
  console.log('==============================================================================');

  try {
    const rawContent = execSync('git show d14f884:.env.local', { encoding: 'utf8' });
    const envVars = {};
    for (const line of rawContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        envVars[k] = v;
      }
    }

    const oldKey = envVars['SUPABASE_SERVICE_ROLE_KEY'];
    const targetUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'];

    if (!oldKey || !targetUrl) {
      console.log('Key or URL missing in parsed vars');
      return;
    }

    const parsedUrl = new URL(targetUrl);
    console.log(`Target project host from commit d14f884: ${parsedUrl.hostname}`);

    const res = await fetch(`${targetUrl}/rest/v1/organizations?select=id&limit=1`, {
      headers: {
        'apikey': oldKey,
        'Authorization': `Bearer ${oldKey}`
      }
    });

    console.log(`HTTP Probe Status: ${res.status} ${res.statusText}`);
    if (res.status === 401 || res.status === 403) {
      console.log('✅ KEY STATUS: REVOKED / INACTIVE (Old leaked key is rejected by Supabase)');
    } else if (res.status >= 200 && res.status < 300) {
      console.log('⚠️ KEY STATUS: ACTIVE (Old key from git history is STILL ACTIVE and must be rotated in Supabase Dashboard)');
    } else {
      console.log(`❓ KEY STATUS: UNEXPECTED RESPONSE (${res.status})`);
    }

    // Compare with current production env key
    const prodEnvPath = path.resolve(__dirname, '../.env.production.local');
    if (fs.existsSync(prodEnvPath)) {
      const prodContent = fs.readFileSync(prodEnvPath, 'utf8');
      const prodMatch = prodContent.match(/SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/);
      if (prodMatch) {
        const prodKey = prodMatch[1].trim().replace(/^['"]|['"]$/g, '');
        const isIdentical = (prodKey === oldKey);
        console.log(`Current Production (.env.production.local) key matches the leaked key: ${isIdentical}`);
      }
    }

    // Compare with staging env key
    const stagingEnvPath = path.resolve(__dirname, '../.env.staging.local');
    if (fs.existsSync(stagingEnvPath)) {
      const stagingContent = fs.readFileSync(stagingEnvPath, 'utf8');
      const stagingMatch = stagingContent.match(/SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/);
      if (stagingMatch) {
        const stagingKey = stagingMatch[1].trim().replace(/^['"]|['"]$/g, '');
        const isIdentical = (stagingKey === oldKey);
        console.log(`Current Staging (.env.staging.local) key matches the leaked key: ${isIdentical}`);
      }
    }

  } catch (err) {
    console.error('Error during key status audit:', err.message);
  }
}

check();
