const { execSync } = require('child_process');

try {
  const raw = execSync('npx vercel api "/v13/deployments?limit=6&teamId=team_GPJgf92gZPMLY35ES6gHd4mG"', { encoding: 'utf8' });
  const d = JSON.parse(raw);
  d.deployments.forEach(dep => {
    console.log(`[${dep.readyState}] ${dep.name} (${dep.url}) - commit: ${dep.meta?.githubCommitSha?.slice(0, 7)}: ${dep.meta?.githubCommitMessage?.slice(0, 60)}`);
  });
} catch (err) {
  console.error('Error fetching Vercel deployments:', err.message);
}
