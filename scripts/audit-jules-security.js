const { execSync } = require('child_process');
const https = require('https');
const path = require('path');

function getSupabaseAccessToken() {
  const psPath = path.resolve(__dirname, 'get-token.ps1');
  return execSync(`powershell -ExecutionPolicy Bypass -File "${psPath}"`, { encoding: 'utf8' }).trim();
}

async function runSqlQuery(sqlQuery, projectRef = 'vouehtlmsunebracahon') {
  const token = getSupabaseAccessToken();
  if (!token) throw new Error('Supabase CLI access token not found');

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sqlQuery });
    const req = https.request(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`Supabase API error (${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('=== JULES FINDING 1: PostgreSQL SECURITY DEFINER & search_path Audit ===\n');

  // 1. Audit public schema CREATE privileges
  const schemaPrivsSql = `
    SELECT 
      r.rolname,
      has_schema_privilege(r.rolname, 'public', 'USAGE') as can_usage,
      has_schema_privilege(r.rolname, 'public', 'CREATE') as can_create
    FROM pg_roles r
    WHERE r.rolname IN ('public', 'anon', 'authenticated', 'postgres', 'service_role')
    ORDER BY r.rolname;
  `;
  const schemaPrivs = await runSqlQuery(schemaPrivsSql);
  console.log('--- 1. Schema "public" Privileges: ---');
  console.table(schemaPrivs);

  // 2. Audit all SECURITY DEFINER functions in public schema
  const secDefFuncsSql = `
    SELECT 
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args,
      p.prosecdef,
      p.proconfig,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
      has_function_privilege('public', p.oid, 'EXECUTE') as public_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' 
      AND p.prosecdef = true
    ORDER BY p.proname;
  `;
  const secDefFuncs = await runSqlQuery(secDefFuncsSql);
  console.log(`\n--- 2. All SECURITY DEFINER Functions in "public" (${secDefFuncs.length} total): ---`);
  
  const issues = [];
  for (const f of secDefFuncs) {
    const configStr = (f.proconfig || []).join(', ');
    const hasSearchPath = configStr.includes('search_path');
    const hasPgTemp = configStr.includes('pg_temp');
    const isPublicOnly = configStr === 'search_path=public';
    const isStrict = configStr.includes('search_path=public, pg_temp') || configStr.includes('search_path=public,pg_temp');

    if (!hasSearchPath) {
      issues.push({ name: f.proname, issue: 'MISSING_SEARCH_PATH', config: configStr, anon: f.anon_execute });
    } else if (isPublicOnly) {
      issues.push({ name: f.proname, issue: 'SEARCH_PATH_WITHOUT_PG_TEMP', config: configStr, anon: f.anon_execute });
    } else if (f.anon_execute) {
      issues.push({ name: f.proname, issue: 'ANON_HAS_EXECUTE', config: configStr, anon: f.anon_execute });
    }
  }

  console.table(secDefFuncs.map(f => ({
    name: f.proname,
    proconfig: (f.proconfig || []).join('; '),
    anon: f.anon_execute,
    auth: f.authenticated_execute
  })));

  console.log('\n--- 3. Potential Security Definer Issues Found: ---');
  console.table(issues);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
