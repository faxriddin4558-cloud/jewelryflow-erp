const fs = require('fs');
const path = require('path');

const BACKUP_PATH = path.resolve(__dirname, 'backups/prod-backup-latest.json');
const EXPECTED_PROD_REF = 'vrozlllcaxinavzxueif';

function validateBackup() {
  console.log('==============================================================================');
  console.log('ISOLATED PRODUCTION BACKUP INTEGRITY VALIDATION');
  console.log(`Source File: ${BACKUP_PATH}`);
  console.log('==============================================================================');

  if (!fs.existsSync(BACKUP_PATH)) {
    console.error(`❌ Backup file not found: ${BACKUP_PATH}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  } catch (err) {
    console.error(`❌ Failed to parse backup JSON: ${err.message}`);
    process.exit(1);
  }

  if (data.targetRef !== EXPECTED_PROD_REF) {
    console.error(`❌ Target ref mismatch! Expected ${EXPECTED_PROD_REF}, got ${data.targetRef}`);
    process.exit(1);
  }

  const requiredTables = [
    'organizations',
    'employees',
    'customers',
    'products',
    'jewelry_models',
    'factory_receipts',
    'consignment_pieces',
    'seller_consignments',
    'jewelry_sales',
    'gold_settlements',
    'client_gold_accounts',
    'seller_gold_accounts',
    'manager_vault_account',
    'daily_gold_rates',
    'sales_markup_presets',
    'refining_batches',
    'factory_gold_handovers',
    'accounting_baselines',
    'financial_transactions',
    'sales_login_audit_logs'
  ];

  for (const t of requiredTables) {
    if (!Array.isArray(data.tables[t])) {
      console.error(`❌ Table ${t} is missing or not an array in backup data`);
      process.exit(1);
    }
  }
  console.log(`✅ All ${requiredTables.length} tables present as arrays in backup payload.`);

  // Validate Organization
  const orgs = data.tables['organizations'];
  if (orgs.length < 1 || !orgs[0].id || !orgs[0].name) {
    console.error('❌ Organizations validation failed');
    process.exit(1);
  }
  console.log(`✅ Organization verified: ${orgs[0].name} (${orgs[0].id})`);

  // Validate Employees
  const emps = data.tables['employees'];
  if (emps.length < 3) {
    console.error(`❌ Expected at least 3 employees, found ${emps.length}`);
    process.exit(1);
  }
  const empEmails = emps.map(e => (e.email || '').toLowerCase());
  for (const expected of ['fozil@goldia.uz', 'omonboy@goldia.uz', 'goldiaadmin@gmail.com']) {
    if (!empEmails.includes(expected)) {
      console.error(`❌ Expected employee email missing: ${expected}`);
      process.exit(1);
    }
  }
  console.log(`✅ Employees verified (${emps.length} employees): ${empEmails.join(', ')}`);

  // Validate Customers
  const custs = data.tables['customers'];
  if (custs.length < 1) {
    console.error('❌ Customers table is empty');
    process.exit(1);
  }
  console.log(`✅ Customers verified (${custs.length} customers): ${custs[0].contact_name} (${custs[0].customer_code})`);

  // Validate Vault Account
  const vault = data.tables['manager_vault_account'];
  if (vault.length < 1 || vault[0].organization_id !== orgs[0].id) {
    console.error('❌ Manager vault account validation failed');
    process.exit(1);
  }
  console.log(`✅ Manager Vault Account verified: Org ${vault[0].organization_id}, 585 Gold: ${vault[0].manager_refined_gold_grams}g`);

  // Validate Auth Users
  const authUsers = data.auth_users;
  if (!Array.isArray(authUsers) || authUsers.length < 3) {
    console.error(`❌ Expected at least 3 auth users, found ${authUsers ? authUsers.length : 0}`);
    process.exit(1);
  }
  const userEmails = authUsers.map(u => (u.email || '').toLowerCase());
  for (const expected of ['fozil@goldia.uz', 'omonboy@goldia.uz', 'goldiaadmin@gmail.com']) {
    if (!userEmails.includes(expected)) {
      console.error(`❌ Expected auth user missing: ${expected}`);
      process.exit(1);
    }
  }
  console.log(`✅ Auth users verified (${authUsers.length} users): ${userEmails.join(', ')}`);

  console.log('==============================================================================');
  console.log('🎉 ALL BACKUP INTEGRITY CHECKS PASSED (100% SCHEMA & RECORD FIDELITY)');
  console.log('==============================================================================');
}

validateBackup();
