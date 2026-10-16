const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');
const { startStagingServer, stopStagingServer } = require('./isolated-staging-supabase-server');

const ENV_LOCAL_PATH = path.resolve(__dirname, '../.env.local');
const ENV_BACKUP_PATH = path.resolve(__dirname, '../.env.local.backup');
const TEST_RESULTS_DIR = path.resolve(__dirname, '../test-results');

const STAGING_ENV_CONTENT = `# ISOLATED LOCAL STAGING CONFIGURATION
# Generated automatically by run-isolated-browser-e2e.js
# Targets disposable local PGlite PostgreSQL WASM server ONLY
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=staging-anon-key-jewelryflow-2026
SUPABASE_SERVICE_ROLE_KEY=staging-service-role-key-jewelryflow-2026
NEXT_PUBLIC_APP_ENV=staging
`;

function waitForUrl(url, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for ${url}`));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

function killProcessTree(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {}
}

async function main() {
  console.log('======================================================================');
  console.log('JEWELRYFLOW ERP — ISOLATED STAGING & PLAYWRIGHT BROWSER E2E RUNNER');
  console.log('======================================================================');

  let hadOriginalEnv = false;
  let nextProcess = null;

  try {
    // 1. Safety backup of .env.local
    if (fs.existsSync(ENV_LOCAL_PATH)) {
      hadOriginalEnv = true;
      fs.copyFileSync(ENV_LOCAL_PATH, ENV_BACKUP_PATH);
      console.log('[SAFETY] Backed up existing .env.local to .env.local.backup');
      try {
        if (process.platform === 'win32') {
          execSync(`attrib -H "${ENV_LOCAL_PATH}"`, { stdio: 'ignore' });
        }
        fs.unlinkSync(ENV_LOCAL_PATH);
      } catch {}
    }

    // 2. Write staging .env.local
    fs.writeFileSync(ENV_LOCAL_PATH, STAGING_ENV_CONTENT, 'utf8');
    console.log('[STAGING] Staging .env.local written pointing to http://127.0.0.1:54321');

    // 3. Ensure test-results directory
    if (!fs.existsSync(TEST_RESULTS_DIR)) {
      fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
    }

    // 4. Start Isolated Staging Supabase Server
    console.log('[STAGING] Booting isolated Supabase staging server on port 54321...');
    await startStagingServer(54321);
    console.log('[STAGING] Isolated Supabase staging server ready.');

    // 5. Build Next.js with Staging configuration
    console.log('[NEXT] Building Next.js production bundle with staging environment...');
    execSync('npx next build', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }
    });
    console.log('[NEXT] Build complete.');

    // 6. Start Next.js production server on port 3000
    console.log('[NEXT] Starting Next.js server on port 3000...');
    nextProcess = spawn('npx', ['next', 'start', '-p', '3000'], {
      cwd: path.resolve(__dirname, '..'),
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, PORT: '3000' }
    });

    console.log('[NEXT] Waiting for http://localhost:3000 to be ready...');
    await waitForUrl('http://localhost:3000', 30000);
    console.log('[NEXT] Server is listening and ready at http://localhost:3000.');

    // 7. Run Playwright E2E Tests
    console.log('\n======================================================================');
    console.log('EXECUTING PLAYWRIGHT BROWSER E2E TESTS');
    console.log('======================================================================\n');

    const playwrightResult = spawn('npx', ['playwright', 'test'], {
      cwd: path.resolve(__dirname, '..'),
      shell: true,
      stdio: 'inherit'
    });

    const exitCode = await new Promise((resolve) => {
      playwrightResult.on('close', resolve);
    });

    console.log(`\n[PLAYWRIGHT] Test execution completed with exit code: ${exitCode}`);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } catch (err) {
    console.error('[ERROR] Fatal failure during E2E test execution:', err);
    process.exitCode = 1;
  } finally {
    // 8. Teardown Next.js
    if (nextProcess && nextProcess.pid) {
      console.log('[TEARDOWN] Stopping Next.js server...');
      killProcessTree(nextProcess.pid);
    }

    // 9. Teardown Staging Server
    console.log('[TEARDOWN] Stopping isolated Supabase staging server...');
    await stopStagingServer();

    // 10. Restore original .env.local
    if (hadOriginalEnv && fs.existsSync(ENV_BACKUP_PATH)) {
      try {
        if (fs.existsSync(ENV_LOCAL_PATH)) {
          if (process.platform === 'win32') {
            try { execSync(`attrib -H "${ENV_LOCAL_PATH}"`, { stdio: 'ignore' }); } catch {}
          }
          fs.unlinkSync(ENV_LOCAL_PATH);
        }
        fs.copyFileSync(ENV_BACKUP_PATH, ENV_LOCAL_PATH);
        fs.unlinkSync(ENV_BACKUP_PATH);
        if (process.platform === 'win32') {
          try { execSync(`attrib +H "${ENV_LOCAL_PATH}"`, { stdio: 'ignore' }); } catch {}
        }
        console.log('[SAFETY] Original .env.local restored from backup.');
      } catch (err) {
        console.error('[SAFETY-WARN] Failed to restore .env.local:', err.message);
      }
    } else if (fs.existsSync(ENV_LOCAL_PATH)) {
      if (process.platform === 'win32') {
        try { execSync(`attrib -H "${ENV_LOCAL_PATH}"`, { stdio: 'ignore' }); } catch {}
      }
      fs.unlinkSync(ENV_LOCAL_PATH);
      console.log('[SAFETY] Cleaned up temporary staging .env.local.');
    }

    console.log('[DONE] Teardown and security verification complete.');
  }
}

main();
