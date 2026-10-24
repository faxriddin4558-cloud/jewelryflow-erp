const { execSync } = require('child_process');

function getVercelData(endpoint) {
  try {
    const raw = execSync(`npx vercel api "${endpoint}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(raw);
  } catch (e) {
    return { error: e.message };
  }
}

console.log('=== VERCEL DEPLOYMENT & PROJECT AUDIT ===');
const staging = getVercelData('/v9/projects/jewelryflow-sales-staging?teamId=team_GPJgf92gZPMLY35ES6gHd4mG');
const prod = getVercelData('/v9/projects/goldia-sales-production?teamId=team_GPJgf92gZPMLY35ES6gHd4mG');

console.log('\n[1] STAGING PROJECT:');
console.log('  Name:                  ', staging.name);
console.log('  ID:                    ', staging.id);
console.log('  Link:                  ', staging.link ? `${staging.link.org}/${staging.link.repo} (branch: ${staging.link.productionBranch})` : 'None');
const stgTarget = staging.targets?.production;
console.log('  Production Target Dep: ', stgTarget ? `${stgTarget.id} (${stgTarget.url})` : 'None');
console.log('  Target Commit SHA:     ', stgTarget?.meta?.githubCommitSha || 'None');
console.log('  Target Commit Msg:     ', stgTarget?.meta?.githubCommitMessage || 'None');
console.log('  Target Commit Ref:     ', stgTarget?.meta?.githubCommitRef || 'None');

const stgLatest = staging.latestDeployments?.[0];
console.log('  Latest Preview Dep:    ', stgLatest ? `${stgLatest.id} (${stgLatest.url})` : 'None');
console.log('  Preview Commit SHA:    ', stgLatest?.meta?.githubCommitSha || 'None');
console.log('  Preview Commit Msg:    ', stgLatest?.meta?.githubCommitMessage || 'None');

console.log('\n[2] PRODUCTION PROJECT:');
console.log('  Name:                  ', prod.name);
console.log('  ID:                    ', prod.id);
console.log('  Link:                  ', prod.link ? `${prod.link.org}/${prod.link.repo} (branch: ${prod.link.productionBranch})` : 'None (NOT CONNECTED TO GIT)');
const prodTarget = prod.targets?.production;
console.log('  Production Target Dep: ', prodTarget ? `${prodTarget.id} (${prodTarget.url})` : 'None');
console.log('  Target Commit SHA:     ', prodTarget?.meta?.githubCommitSha || 'None');
console.log('  Target Commit Msg:     ', prodTarget?.meta?.githubCommitMessage || 'None');
console.log('  Target Commit Ref:     ', prodTarget?.meta?.githubCommitRef || 'None');
console.log('  Target ReadyState:     ', prodTarget?.readyState || 'None');

console.log('  Deployments list:');
(prod.latestDeployments || []).forEach((d, i) => {
  console.log(`   [${i+1}] ${d.id} | ${d.readyState} | SHA: ${d.meta?.githubCommitSha?.slice(0, 7)} | Ref: ${d.meta?.githubCommitRef} | ${d.url}`);
});
