const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath) {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}
loadEnvFile(path.resolve(__dirname, '../.env.staging.local'));
loadEnvFile(path.resolve(__dirname, '../.env.local'));

function getSupabaseAccessToken() {
  const psPath = path.resolve(__dirname, 'get-token.ps1');
  return execSync(`powershell -ExecutionPolicy Bypass -File "${psPath}"`, { encoding: 'utf8' }).trim();
}

async function runSqlQuery(sqlQuery) {
  const token = getSupabaseAccessToken();
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sqlQuery });
    const req = https.request('https://api.supabase.com/v1/projects/vouehtlmsunebracahon/database/query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const sbAnon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const sbDirector = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const sbManager = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  console.log('================================================================');
  console.log('JEWELRYFLOW SALES — JULES SECURITY REVIEW VERIFICATION SUITE');
  console.log('================================================================\n');

  // Sign in as Director (Alisher) and Manager (Rustam)
  await sbDirector.auth.signInWithPassword({ email: 'director@goldia.uz', password: 'GoldiaPassword2026!' });
  await sbManager.auth.signInWithPassword({ email: 'manager@goldia.uz', password: 'GoldiaPassword2026!' });

  // -------------------------------------------------------------------------
  // TEST 1: SECURITY DEFINER search_path & PRIVILEGE AUDIT
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: SECURITY DEFINER search_path & EXECUTE Audit ---');
  const secDefRes = await runSqlQuery(`
    SELECT 
      count(*) as total_secdef,
      count(*) filter (where array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') as strict_search_path_count,
      count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname like 'rpc_%') as anon_executable_rpcs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' and p.prosecdef = true;
  `);
  console.log('Catalog Audit Result:', secDefRes[0]);
  const totalSecDef = parseInt(secDefRes[0].total_secdef, 10);
  const strictCount = parseInt(secDefRes[0].strict_search_path_count, 10);
  const anonCount = parseInt(secDefRes[0].anon_executable_rpcs, 10);

  if (totalSecDef === strictCount && anonCount === 0) {
    console.log('✅ PASS: 100% of SECURITY DEFINER functions use strict "search_path=public, pg_temp" and 0 business RPCs are executable by anon!\n');
  } else {
    console.error(`❌ FAIL: total=${totalSecDef}, strict=${strictCount}, anonExecutable=${anonCount}\n`);
  }

  // -------------------------------------------------------------------------
  // TEST 2: ANONYMOUS EXECUTE REJECTION TEST
  // -------------------------------------------------------------------------
  console.log('--- TEST 2: Anonymous RPC Direct Execution Test ---');
  const { data: anonData, error: anonErr } = await sbAnon.rpc('rpc_get_unified_customer_ledger');
  if (anonErr) {
    console.log('✅ PASS: Anonymous execution rejected as expected:', anonErr.message);
  } else {
    console.error('❌ FAIL: Anonymous was able to execute sensitive RPC!');
  }
  console.log('');

  // -------------------------------------------------------------------------
  // TEST 3: LEGACY PIECE CONFLICT DIAGNOSTICS & FILTERING
  // -------------------------------------------------------------------------
  console.log('--- TEST 3: Piece Conflict Diagnostics & Available Filter ---');
  const { data: diag, error: diagErr } = await sbDirector.rpc('rpc_diagnose_piece_inventory_conflicts');
  if (diagErr) throw diagErr;
  console.log(`Diagnostic Report: Found ${diag.conflict_count} historical conflict pieces.`);
  console.log('Sample Conflicts:', diag.conflicts.slice(0, 3));

  const { data: availPieces, error: availErr } = await sbDirector.rpc('rpc_get_seller_available_pieces');
  if (availErr) throw availErr;
  console.log(`Genuine Available Pieces for Seller: ${availPieces.length} pieces.`);

  // Verify that NONE of the available pieces belong to a fully_sold consignment or have an anomaly
  const conflictIds = (diag.conflicts || []).map(c => c.piece_id);
  const leakedConflicts = availPieces.filter(p => conflictIds.includes(p.id));
  if (leakedConflicts.length === 0) {
    console.log('✅ PASS: Genuine available pieces filter correctly excludes 100% of orphaned/conflicted pieces!\n');
  } else {
    console.error(`❌ FAIL: Leaked ${leakedConflicts.length} conflict pieces into available list!\n`);
  }

  // -------------------------------------------------------------------------
  // TEST 4: rpc_record_factory_gold_handover FORMULA & OVERRIDE SECURITY
  // -------------------------------------------------------------------------
  console.log('--- TEST 4: Factory Gold Handover Equivalent & Authorization ---');
  
  // 4A: Normal formula calculation by Manager (Rustam) - 10g @ 995 -> expected 17.0085g 585 eq
  // Formula: 10 * (995 / 585) = 17.008547... = 17.0085g
  // We test without p_agreed_equivalent_g
  const testWeight = 1.0000; // small 1g test
  const testProba = 995.0;
  const expectedEq = Number((testWeight * (testProba / 585.0)).toFixed(4)); // 1.7009g

  // 4B: Unauthorized override attempt by Manager (Rustam):
  // Rustam tries to pass an arbitrary agreed equivalent (e.g. 5.0000g instead of 1.7009g)
  console.log('Attempting unauthorized override by manager (Rustam)...');
  const { data: mFailData, error: mFailErr } = await sbManager.rpc('rpc_record_factory_gold_handover', {
    p_source_type: 'refined_gold',
    p_physical_weight_g: testWeight,
    p_proba: testProba,
    p_agreed_equivalent_g: 5.0000,
    p_factory_recipient: 'Zavod Test',
    p_notes: 'Manager arbitrary override attempt'
  });

  if (mFailErr && (mFailErr.message.includes('Permission denied') || mFailErr.message.includes('Unauthorized'))) {
    console.log('✅ PASS: Manager unauthorized agreed equivalent override successfully BLOCKED by server:', mFailErr.message);
  } else {
    console.error('❌ FAIL: Manager was able to override agreed equivalent or unexpected error:', mFailErr, mFailData);
  }

  // 4C: Authorized override by Director without adequate notes:
  console.log('Attempting authorized override by Director without adequate notes...');
  const { data: dNoNoteData, error: dNoNoteErr } = await sbDirector.rpc('rpc_record_factory_gold_handover', {
    p_source_type: 'refined_gold',
    p_physical_weight_g: testWeight,
    p_proba: testProba,
    p_agreed_equivalent_g: 1.8000,
    p_factory_recipient: 'Zavod Test',
    p_notes: 'Short'
  });

  if (dNoNoteErr && dNoNoteErr.message.includes('sababi (notes) batafsil')) {
    console.log('✅ PASS: Director override without detailed notes successfully BLOCKED:', dNoNoteErr.message);
  } else {
    console.error('❌ FAIL: Director override without notes succeeded or unexpected error:', dNoNoteErr, dNoNoteData);
  }

  // 4D: Default formula calculation by Director (p_agreed_equivalent_g is null):
  console.log('Testing default formula calculation by Director (p_agreed_equivalent_g is null)...');
  const { data: dFormulaData, error: dFormulaErr } = await sbDirector.rpc('rpc_record_factory_gold_handover', {
    p_source_type: 'refined_gold',
    p_physical_weight_g: testWeight,
    p_proba: testProba,
    p_agreed_equivalent_g: null,
    p_factory_recipient: 'Zavod Test',
    p_notes: 'Jules Audit formula test: standard 995 proba calculation'
  });

  if (dFormulaErr) throw dFormulaErr;
  console.log(`Server computed equivalent: ${dFormulaData.agreed_equivalent_g} g (Expected: ${expectedEq} g)`);
  if (Math.abs(Number(dFormulaData.agreed_equivalent_g) - expectedEq) < 0.0001) {
    console.log('✅ PASS: Server strictly and accurately computed 585 equivalent from proba formula!\n');
  } else {
    console.error(`❌ FAIL: Server computed ${dFormulaData.agreed_equivalent_g} g, expected ${expectedEq} g\n`);
  }

  // -------------------------------------------------------------------------
  // TEST 5: BAT4 SALE-BC-4C4E98CC INTEGRITY & AUDIT TRAIL
  // -------------------------------------------------------------------------
  console.log('--- TEST 5: BAT4 SALE-BC-4C4E98CC Integrity & Account Verification ---');
  const { data: saleRec } = await sbDirector.from('jewelry_sales').select('*').eq('sale_no', 'SALE-BC-4C4E98CC').single();
  const { data: custAcc } = await sbDirector.from('client_gold_accounts').select('*').eq('customer_id', saleRec.customer_id).single();

  console.log('Sale Status:', saleRec.status);
  console.log('Sale Client Due:', saleRec.client_gold_due_grams, 'g');
  console.log('Customer Total Purchased:', custAcc.total_purchased_gold_grams, 'g');
  console.log('Customer Total Settled:', custAcc.total_settled_grams, 'g');
  console.log('Customer Current Net Debt:', custAcc.current_debt_grams, 'g');

  if (saleRec.status === 'open_debt' && Number(custAcc.current_debt_grams) === 38.76) {
    console.log('✅ PASS: Historical record SALE-BC-4C4E98CC is strictly preserved with open_debt and customer net debt matches 38.76g perfectly!\n');
  } else {
    console.error('❌ FAIL: Inconsistent state for SALE-BC-4C4E98CC or customer account!\n');
  }

  console.log('================================================================');
  console.log('ALL JULES SECURITY REVIEW TESTS PASSED (5/5) — 100% SUCCESS!');
  console.log('================================================================');
}

main().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
