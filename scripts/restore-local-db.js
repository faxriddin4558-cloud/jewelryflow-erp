const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');

const DATA_DIR = path.resolve(__dirname, '../.local-pilot-data/db');
const BACKUP_DIR = path.resolve(__dirname, '../.local-backups');
const LOCK_FILE = path.join(path.dirname(DATA_DIR), 'db.lock');

async function restoreBackup(specifiedBackupPath, targetDataDir = DATA_DIR) {
  console.log('======================================================================');
  console.log('JEWELRYFLOW ERP — LOCAL DATABASE RESTORE UTILITY');
  console.log('======================================================================\n');

  // 1. Ensure server is not running
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (lockData.pid) {
        try {
          process.kill(lockData.pid, 0);
          throw new Error(`Database is currently locked by active server (PID ${lockData.pid}). Please stop the server before restoring.`);
        } catch (e) {
          if (e.message.includes('locked by active server')) throw e;
        }
      }
    } catch (e) {
      if (e.message.includes('locked by active server')) throw e;
    }
  }

  // 2. Identify target backup
  let backupFolder = specifiedBackupPath;
  if (!backupFolder) {
    if (!fs.existsSync(BACKUP_DIR)) {
      throw new Error(`No backups found in ${BACKUP_DIR}`);
    }
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup-')).sort().reverse();
    if (backups.length === 0) {
      throw new Error(`No backup folders found in ${BACKUP_DIR}`);
    }
    backupFolder = path.join(BACKUP_DIR, backups[0]);
    console.log(`[RESTORE] No backup specified. Automatically selecting most recent backup: ${backups[0]}`);
  }

  const backupDbDir = path.join(backupFolder, 'db');
  if (!fs.existsSync(backupDbDir)) {
    throw new Error(`Invalid backup directory: ${backupFolder} does not contain 'db' folder`);
  }

  // 3. Create pre-restore safety snapshot of current data (Never silently destroy data!)
  if (fs.existsSync(targetDataDir)) {
    const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyDir = path.join(BACKUP_DIR, `pre-restore-safety-${safetyTimestamp}`);
    fs.mkdirSync(safetyDir, { recursive: true });
    fs.cpSync(targetDataDir, path.join(safetyDir, 'db'), { recursive: true });
    console.log(`[SAFETY] Current database copied to safety snapshot: ${safetyDir}`);
    fs.rmSync(targetDataDir, { recursive: true, force: true });
  }

  // 4. Restore files
  fs.mkdirSync(targetDataDir, { recursive: true });
  fs.cpSync(backupDbDir, targetDataDir, { recursive: true });
  console.log(`[RESTORE] Backup data successfully copied to: ${targetDataDir}`);

  // 5. Verify integrity of restored database
  console.log('[RESTORE] Verifying readability of restored database with PGlite...');
  const db = new PGlite(targetDataDir, { extensions: { uuid_ossp } });
  const countRes = await db.query('SELECT count(*)::int as cnt FROM public.batches;');
  const orgRes = await db.query('SELECT code, name FROM public.organizations;');
  await db.close();

  console.log(`[RESTORE] Database integrity verified:`);
  console.log(`  Organizations: ${orgRes.rows.map(o => `${o.code} (${o.name})`).join(', ')}`);
  console.log(`  Batches count: ${countRes.rows[0].cnt}`);
  console.log('\n[SUCCESS] Local database restoration completed safely.\n');
}

async function main() {
  const targetBackup = process.argv[2] || null;
  try {
    await restoreBackup(targetBackup);
  } catch (err) {
    console.error('\n[ERROR] Restore failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { restoreBackup };
