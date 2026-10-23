const fs = require('fs');
const { execSync } = require('child_process');

console.log('=== 1. Checking .gitignore for .env ===');
const gitignore = fs.readFileSync('.gitignore', 'utf8');
const envRules = gitignore.split('\n').filter(l => l.includes('.env'));
console.log('Env rules in .gitignore:', envRules);

console.log('\n=== 2. Checking Git tracked files for .env ===');
try {
  const tracked = execSync('git ls-files "*.env*"', { encoding: 'utf8' }).trim();
  console.log('Tracked .env files:', tracked || 'NONE (CLEAN)');
} catch (e) {
  console.log('Error checking tracked files:', e.message);
}

console.log('\n=== 3. Searching src/ for service role or secret keywords ===');
try {
  const srcMatches = execSync('git grep -i "service_role" src/', { encoding: 'utf8' }).trim();
  console.log('src/ service_role matches:\n' + srcMatches);
} catch (e) {
  console.log('No service_role in src/');
}

console.log('\n=== 4. Checking if any NEXT_PUBLIC variable contains secret ===');
const envExample = fs.existsSync('.env.example') ? fs.readFileSync('.env.example', 'utf8') : '';
console.log('.env.example lines:');
envExample.split('\n').filter(l => l.trim() && !l.startsWith('#')).forEach(l => console.log('  ' + l.split('=')[0]));

console.log('\n=== 5. Git history search for SUPABASE_SERVICE_ROLE_KEY values ===');
try {
  const gitLog = execSync('git log -S "SUPABASE_SERVICE_ROLE_KEY" --oneline', { encoding: 'utf8' }).trim();
  console.log('Commits mentioning SUPABASE_SERVICE_ROLE_KEY:\n' + (gitLog || 'NONE'));
} catch (e) {
  console.log('None found in git log');
}

console.log('\n=== 6. Searching client bundle / "use client" files for SUPABASE_SERVICE_ROLE_KEY ===');
const filesInSrc = [];
function walkDir(dir) {
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== 'node_modules' && f !== '.next') walkDir(p);
    } else if (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')) {
      filesInSrc.push(p);
    }
  });
}
const path = require('path');
walkDir(path.resolve(__dirname, '../src'));

let clientLeakedCount = 0;
filesInSrc.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  if (content.includes('SUPABASE_SERVICE_ROLE_KEY')) {
    const isClient = content.includes('"use client"') || content.includes("'use client'");
    console.log(`  File: ${path.relative(process.cwd(), f)} | Client Component: ${isClient}`);
    if (isClient) clientLeakedCount++;
  }
});
console.log(`Client bundle leaks found: ${clientLeakedCount}`);
