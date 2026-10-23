const fs = require('fs');
const path = require('path');

const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

console.log('==============================================================================');
console.log(`VERIFYING MIGRATIONS 001-042 CLEAN INSTALL DEPENDENCY GRAPH (${files.length} files)`);
console.log('==============================================================================');

const createdTables = new Set();
const createdTypes = new Set();
const createdFunctions = new Set();
const unresolvedFKs = [];
const errors = [];

files.forEach((file, idx) => {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  
  // Track types / enums
  const typeRegex = /create\s+type\s+(public\.)?([a-zA-Z0-9_]+)/gi;
  let typeMatch;
  while ((typeMatch = typeRegex.exec(content)) !== null) {
    createdTypes.add(typeMatch[2].toLowerCase());
  }

  // Track tables
  const tableRegex = /create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?([a-zA-Z0-9_]+)/gi;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(content)) !== null) {
    createdTables.add(tableMatch[3].toLowerCase());
  }

  // Track functions
  const funcRegex = /create\s+(or\s+replace\s+)?function\s+(public\.)?([a-zA-Z0-9_]+)/gi;
  let funcMatch;
  while ((funcMatch = funcRegex.exec(content)) !== null) {
    createdFunctions.add(funcMatch[3].toLowerCase());
  }

  // Check foreign key references
  const fkRegex = /references\s+(public\.)?([a-zA-Z0-9_]+)\s*\(([a-zA-Z0-9_]+)\)/gi;
  let fkMatch;
  while ((fkMatch = fkRegex.exec(content)) !== null) {
    const refTable = fkMatch[2].toLowerCase();
    // auth.users is external, so ignore
    if (refTable !== 'users' && !createdTables.has(refTable)) {
      unresolvedFKs.push({ file, refTable, targetCol: fkMatch[3] });
    }
  }
});

console.log(`Total Tables Defined: ${createdTables.size}`);
console.log(`Total Types/Enums Defined: ${createdTypes.size}`);
console.log(`Total Functions Defined: ${createdFunctions.size}`);
console.log(`Unresolved FKs at end of run: ${unresolvedFKs.length}`);

if (unresolvedFKs.length > 0) {
  console.log('Unresolved Foreign Keys:', unresolvedFKs);
} else {
  console.log('✅ ALL Foreign Key dependencies resolve within migrations 001-042!');
}

// Check for dangerous operations: DROP TABLE, TRUNCATE
let dangerousOps = [];
files.forEach(file => {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  if (/drop\s+table/i.test(content)) {
    dangerousOps.push({ file, op: 'DROP TABLE' });
  }
  if (/truncate\s+table/i.test(content)) {
    dangerousOps.push({ file, op: 'TRUNCATE TABLE' });
  }
});

console.log(`Dangerous operations (DROP/TRUNCATE): ${dangerousOps.length}`);
dangerousOps.forEach(d => console.log(` - [${d.file}] ${d.op}`));

console.log('==============================================================================');
