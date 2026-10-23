const fs = require('fs');
const path = require('path');

const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

console.log(`Found ${files.length} migration files in ${migrationsDir}`);

const report = {
  totalFiles: files.length,
  insertsByTable: {},
  demoInserts: [],
  catalogInserts: [],
  syntaxChecks: [],
  authDependencies: [],
  securityDefinerFunctions: []
};

files.forEach(file => {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  
  // Find all INSERT INTO statements
  const insertRegex = /insert\s+into\s+([a-zA-Z0-9_\."]+)/gi;
  let match;
  while ((match = insertRegex.exec(content)) !== null) {
    const table = match[1].toLowerCase().replace(/"/g, '');
    report.insertsByTable[table] = (report.insertsByTable[table] || 0) + 1;
    
    // Check if it's inserting demo / test data
    if (/demo|test|pilot|sample/i.test(table) || /demo|fake|test|alisher|rustam|jamshid/i.test(content.slice(match.index, match.index + 500))) {
      report.demoInserts.push({ file, table, snippet: content.slice(match.index, match.index + 150).replace(/\s+/g, ' ') });
    }
  }

  // Check auth dependencies
  if (/auth\.users/i.test(content)) {
    report.authDependencies.push(file);
  }

  // Check security definer
  const secDefRegex = /create\s+(or\s+replace\s+)?function\s+([a-zA-Z0-9_\."]+)[^;]+security\s+definer/gi;
  let secMatch;
  while ((secMatch = secDefRegex.exec(content)) !== null) {
    report.securityDefinerFunctions.push({ file, func: secMatch[2] });
  }
});

console.log('\nInserts by Table:');
console.table(report.insertsByTable);

console.log('\nPotential Demo Data Inserts count:', report.demoInserts.length);
report.demoInserts.forEach(d => console.log(`[${d.file}] ${d.table}: ${d.snippet}`));

console.log('\nAuth dependencies count:', report.authDependencies.length);
console.log(report.authDependencies);
