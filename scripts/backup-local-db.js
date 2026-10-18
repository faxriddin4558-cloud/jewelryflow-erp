const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = path.resolve(__dirname, '../.local-pilot-data/db');
const BACKUP_DIR = path.resolve(__dirname, '../.local-backups');
const LOCK_FILE = path.join(path.dirname(DATA_DIR), 'db.lock');

async function triggerServerBackup() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      'http://127.0.0.1:54321/staging/backup',
      { method: 'POST', timeout: 5000 },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200 && json.success) {
              resolve(json);
            } else {
              reject(new Error(json.message || 'Backup endpoint returned error'));
            }
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function offlineFilesystemBackup() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (lockData.pid) {
        try {
          process.kill(lockData.pid, 0);
          throw new Error(`Database is currently locked by active server (PID ${lockData.pid}). Use live backup endpoint or stop server first.`);
        } catch (e) {
          if (e.message.includes('locked by active server')) throw e;
          // Process dead, lock stale
        }
      }
    } catch (e) {
      if (e.message.includes('locked by active server')) throw e;
    }
  }

  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`No local database directory found at ${DATA_DIR}. Nothing to back up.`);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = path.join(BACKUP_DIR, `backup-${timestamp}`);
  fs.mkdirSync(targetDir, { recursive: true });

  fs.cpSync(DATA_DIR, path.join(targetDir, 'db'), { recursive: true });

  const manifest = {
    backupName: `backup-${timestamp}`,
    timestamp: new Date().toISOString(),
    sourceDir: DATA_DIR,
    method: 'offline-filesystem-snapshot',
    engine: 'PGlite PostgreSQL 18/16 WASM'
  };
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return { success: true, targetDir, manifest };
}

async function main() {
  console.log('======================================================================');
  console.log('JEWELRYFLOW ERP — LOCAL DATABASE BACKUP UTILITY');
  console.log('Target: .local-pilot-data/db -> .local-backups/');
  console.log('======================================================================\n');

  try {
    // Try live server backup first
    try {
      console.log('[BACKUP] Checking if live pilot server is running at http://127.0.0.1:54321...');
      const liveRes = await triggerServerBackup();
      console.log('[BACKUP] Live server snapshot successfully created:');
      console.log(`  Target Directory : ${liveRes.targetDir}`);
      console.log(`  Total Tables     : ${liveRes.manifest.totalTables}`);
      console.log(`  Active Batches   : ${liveRes.manifest.recordCounts.batches}`);
      console.log(`  Gold Tx Count    : ${liveRes.manifest.recordCounts.goldTransactions}`);
      console.log(`  Orders Count     : ${liveRes.manifest.recordCounts.orders}`);
      console.log('\n[SUCCESS] Backup completed cleanly.\n');
      return;
    } catch (liveErr) {
      console.log('[BACKUP] Live server is offline or unreachable. Creating offline filesystem snapshot...');
    }

    const res = offlineFilesystemBackup();
    console.log('[BACKUP] Offline filesystem snapshot successfully created:');
    console.log(`  Target Directory : ${res.targetDir}`);
    console.log(`  Timestamp        : ${res.manifest.timestamp}`);
    console.log('\n[SUCCESS] Backup completed cleanly.\n');
  } catch (err) {
    console.error('\n[ERROR] Backup failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { triggerServerBackup, offlineFilesystemBackup };
