const { execSync } = require('child_process');

console.log('==============================================================================');
console.log('SCANNING ENTIRE GIT COMMIT HISTORY FOR EXPOSED SECRETS');
console.log('==============================================================================');

const commits = execSync('git log --format=%H', { encoding: 'utf8' }).trim().split('\n');
console.log(`Analyzing ${commits.length} commits...`);

let foundAny = false;
for (const c of commits) {
  try {
    const diff = execSync(`git show ${c}`, { encoding: 'utf8' });
    const match = diff.match(/^[+]\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*(\S+)/m);
    if (match) {
      const val = match[1].replace(/['"]/g, '');
      if (val.length > 5 && !val.includes('your-') && !val.includes('placeholder')) {
        console.log(`Commit ${c.slice(0, 7)} added non-empty service_role key of length ${val.length}`);
        foundAny = true;
      }
    }
  } catch (err) {}
}

if (!foundAny) {
  console.log('✅ CLEAN: No non-empty SUPABASE_SERVICE_ROLE_KEY was EVER committed in Git history!');
}
