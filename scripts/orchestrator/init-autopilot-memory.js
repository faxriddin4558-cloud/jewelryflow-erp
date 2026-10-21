const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const memoryDir = path.resolve(__dirname, '../../memory');
if (!fs.existsSync(memoryDir)) {
  fs.mkdirSync(memoryDir, { recursive: true });
}

const dbPath = path.join(memoryDir, 'memory.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id TEXT PRIMARY KEY,
    agent_name TEXT NOT NULL,
    session_title TEXT NOT NULL,
    status TEXT NOT NULL,
    source_repo TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    base_commit TEXT NOT NULL,
    working_branch TEXT NOT NULL,
    task_description TEXT,
    last_activity TEXT,
    pr_url TEXT,
    modified_files_count INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS task_registry (
    task_id TEXT PRIMARY KEY,
    task_title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    owner_agent TEXT NOT NULL,
    source_branch TEXT NOT NULL,
    source_commit_sha TEXT NOT NULL,
    working_branch TEXT NOT NULL,
    allowed_file_paths TEXT,
    forbidden_file_paths TEXT,
    jules_session_id TEXT,
    pull_request_url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    approval_status TEXT NOT NULL,
    test_status TEXT,
    audit_status TEXT,
    merge_status TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_trail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    task_id TEXT,
    details TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed known sessions and tasks
const insertSession = db.prepare(`
  INSERT INTO agent_sessions (
    session_id, agent_name, session_title, status, source_repo, base_branch, base_commit,
    working_branch, task_description, last_activity, pr_url, modified_files_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    session_title = excluded.session_title,
    status = excluded.status,
    base_branch = excluded.base_branch,
    base_commit = excluded.base_commit,
    working_branch = excluded.working_branch,
    task_description = excluded.task_description,
    last_activity = excluded.last_activity,
    pr_url = excluded.pr_url,
    modified_files_count = excluded.modified_files_count,
    updated_at = CURRENT_TIMESTAMP;
`);

// 1. Jules Sprint 1 Initial (PR #1)
insertSession.run(
  '6075853144144189463',
  'Google Jules',
  'feat(manufacturing): implement frontend components for operator UI',
  'SUPERSEDED',
  'faxriddin4558-cloud/jewelryflow-erp',
  'main',
  '4ddc0d0',
  'jules/manufacturing-operator-ui-6075853144144189463',
  'Sprint 1 initial operator touch UI components',
  '2026-10-15T18:00:00Z',
  'https://github.com/faxriddin4558-cloud/jewelryflow-erp/pull/1',
  12
);

// 2. Jules Sprint 1 & 2B Combined (PR #2)
insertSession.run(
  '14301525538687653064',
  'Google Jules',
  'feat(frontend): create manufacturing operator UI components & Sprint 2B dashboards',
  'COMPLETED_NEEDS_REBASE',
  'faxriddin4558-cloud/jewelryflow-erp',
  'main',
  '4ddc0d0',
  'jules/manufacturing-operator-ui-v2-14301525538687653064',
  'Sprint 1 operator UI + Sprint 2B OwnerDashboard, PieceworkDashboard, QcInspectionForm, ReportDataTable, ReportFilterBar, hooks & tests',
  '2026-10-16T08:07:11Z',
  'https://github.com/faxriddin4558-cloud/jewelryflow-erp/pull/2',
  67
);

// 3. Antigravity Local Engine & Hardening Session
insertSession.run(
  'antigravity-local-sprint2a',
  'Google Antigravity',
  'JEWELRYFLOW ERP — PARALLEL SPRINT 2A: DATABASE & SECURITY HARDENING',
  'COMPLETED_LOCAL_VERIFIED',
  'faxriddin4558-cloud/jewelryflow-erp',
  'dev/manufacturing-erp-saas',
  '06ad6de',
  'dev/manufacturing-erp-saas',
  'Database migration 024, piecework salary over-adjustment protection, QC rework completion RPC, multi-tenant unique index scoping, 51/51 real DB tests, 10/10 browser E2E tests',
  '2026-10-16T12:21:00Z',
  null,
  7
);

const insertTask = db.prepare(`
  INSERT INTO task_registry (
    task_id, task_title, description, status, owner_agent, source_branch, source_commit_sha,
    working_branch, allowed_file_paths, forbidden_file_paths, jules_session_id, pull_request_url,
    approval_status, test_status, audit_status, merge_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(task_id) DO UPDATE SET
    status = excluded.status,
    approval_status = excluded.approval_status,
    test_status = excluded.test_status,
    audit_status = excluded.audit_status,
    merge_status = excluded.merge_status,
    updated_at = CURRENT_TIMESTAMP;
`);

// Task 1: Jules Sprint 1 UI
insertTask.run(
  'TASK-JULES-01',
  'Manufacturing Operator Touch UI Components (Sprint 1)',
  'Build 6 touch-friendly components for factory tablets and handover weight hook',
  'MERGED_VIA_INTEGRATION',
  'Google Jules',
  'dev/manufacturing-erp-saas',
  '17bf939',
  'jules/manufacturing-operator-ui-v2-14301525538687653064',
  'src/components/manufacturing/*,src/hooks/manufacturing/*',
  'supabase/*,src/lib/erp-engine.ts,src/lib/two-party-handover.ts',
  '14301525538687653064',
  'https://github.com/faxriddin4558-cloud/jewelryflow-erp/pull/2',
  'APPROVED',
  'PASS (Vitest 111/111)',
  'AUDITED (Option A clean merge into dev)',
  'INTEGRATED (Commit f275ff6)'
);

// Task 2: Jules Sprint 2B Dashboards & QC Form
insertTask.run(
  'TASK-JULES-02B',
  'Professional Factory Frontend: Owner & Piecework Dashboards, QC Form, Reports (Sprint 2B)',
  'OwnerDashboard, PieceworkDashboard, QcInspectionForm, ReportDataTable, ReportFilterBar, use-piecework hook',
  'REVIEW_PENDING_REBASE',
  'Google Jules',
  'dev/manufacturing-erp-saas',
  '06ad6de',
  'jules/manufacturing-operator-ui-v2-14301525538687653064',
  'src/components/manufacturing/*,src/hooks/manufacturing/*',
  'supabase/*,src/lib/*,scripts/*',
  '14301525538687653064',
  'https://github.com/faxriddin4558-cloud/jewelryflow-erp/pull/2',
  'PENDING_HUMAN_APPROVAL',
  'NOT_RUN_ON_DEV',
  'AUDIT_WARN (Targeted main instead of dev/manufacturing-erp-saas)',
  'UNMERGED'
);

// Task 3: Antigravity Sprint 2A Database Hardening
insertTask.run(
  'TASK-AG-02A',
  'Database & Security Hardening (Sprint 2A)',
  'Multi-tenant unique index scoping, payroll over-adjustment prevention, QC rework completion RPC, 024 migration',
  'VERIFIED_READY_TO_PUSH',
  'Google Antigravity',
  'dev/manufacturing-erp-saas',
  '06ad6de',
  'dev/manufacturing-erp-saas',
  'supabase/migrations/*,src/lib/erp-engine.ts,src/lib/quality-control.ts,scripts/*',
  'src/components/manufacturing/*',
  null,
  null,
  'APPROVED',
  'PASS (112 Vitest, 51 Real DB, 10 Browser E2E, 32 Next.js Pages)',
  'AUDITED_PASS',
  'COMMITTED_LOCAL (8b99ff7)'
);

const insertAudit = db.prepare(`
  INSERT INTO audit_trail (event_type, agent_name, task_id, details)
  VALUES (?, ?, ?, ?);
`);

insertAudit.run(
  'MEMORY_SYNC',
  'Autopilot Orchestrator',
  null,
  'Initialized SQLite memory.db and synchronized all historical and active sessions from GitHub & local dev environment.'
);

console.log('SQLite memory.db synchronized successfully:');
const sessions = db.prepare('SELECT session_id, agent_name, status, working_branch, pr_url FROM agent_sessions').all();
console.table(sessions);

const tasks = db.prepare('SELECT task_id, owner_agent, status, source_commit_sha, approval_status FROM task_registry').all();
console.table(tasks);
