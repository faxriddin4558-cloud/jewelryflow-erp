"""Generates supabase/migrations/20260101000091_goldia_factory_handover_c2_fix_seller_lom_purchase.sql and its
rollback from the CURRENT bodies (newest definition in migrations <= 090: exact copies + asserted replacements) and
sql-091-new.sql. Run: python3 -I gen-091.py"""
import os, re, glob
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..')
MIG = [m for m in sorted(glob.glob(os.path.join(R, 'supabase/migrations/2026010100*.sql'))) if os.path.basename(m) < '20260101000091']


def latest(name):
    pat = re.compile(r'create\s+or\s+replace\s+function\s+public\."?%s"?\s*\(' % re.escape(name), re.I)
    best = None
    for f in MIG:
        s = open(f, encoding='utf-8').read()
        for m in pat.finditer(s):
            best = (f, s, m.start())
    assert best, name
    f, s, i = best
    tm = re.compile(r'\bas\s+(\$[a-z_]*\$)', re.I).search(s, i)
    tag = tm.group(1)
    j = s.index(tag, tm.end()) + len(tag)
    assert s[j] == ';', (name, s[j:j + 10])
    return s[i:j + 1], os.path.basename(f)


def rep(s, a, b, n=1):
    assert s.count(a) == n, (a[:100], s.count(a))
    return s.replace(a, b)


CHANGED = ['rpc_record_factory_gold_handover', 'rpc_reverse_factory_gold_handover', '_goldia_guard_finished_goods_handover',
           'rpc_financial_restart', 'rpc_execute_full_test_reset', '_goldia_period_effects']
ORIG = {n: latest(n) for n in CHANGED}
here = os.path.dirname(os.path.abspath(__file__))
NEW = open(os.path.join(here, 'sql-091-new.sql'), encoding='utf-8').read()

out = ['''-- 091 - Goldia Sales (2026-11-19), on top of 090. Nothing existing is rewritten in place; no business row changes.
--
-- 1. C2 fix: rpc_record_factory_gold_handover (073) set total_factory_handed_over_g = sum of the handover rows, which
--    dropped every amount the opening put into that total (C2 factory advance) - the factory net jumped by C2 on the
--    first gold handover after T0. Now a handover / its reversal moves the total by exactly its 585 equivalent through
--    _goldia_vault_factory_add (the helper C, C2 and the 090 goods return already use; it refuses a negative total).
--    Balances that the old code already got wrong are NOT changed by this migration (no guess): the read-only
--    supabase/release/factory_cards_readonly.sql shows the difference per organization (kartalar_farqi_g).
-- 2. Seller buys LOM at the bazaar with till UZS (seller_lom_purchases, rpc_record_seller_lom_purchase / reverse):
--    an exchange inside the seller's till - UZS down, LOM physical + 585 equivalent up; customer debt, seller
--    obligation, factory and profit untouched; in the period report as its own kind (never a collection / expense).
-- 3. The financial restart and the staging test reset also reverse 090 goods returns and 091 LOM purchases; the 090
--    finished-goods handover guard lets them through (their own transaction flag), the generic reversal stays refused.
''', NEW.split('-- @@@ FUNCTIONS @@@')[0]]

VAULT_ADD = '''  -- 091: the handover moves the factory account by exactly its 585 equivalent (C / C2 / goods returns stay in the total)
  perform public._goldia_vault_factory_add(v_org_id, 0, v_agreed_eq);
  select current_factory_obligation_g, current_factory_advance_g into v_new_obligation, v_new_advance
    from public.manager_vault_account where organization_id = v_org_id;
'''
fn, src = ORIG['rpc_record_factory_gold_handover']
a = fn.index('  -- Update factory total obligation vs handovers\n')
b = fn.index('  -- Audit log\n', a)
blk = fn[a:b]
assert 'select coalesce(sum(agreed_equivalent_g), 0) into v_new_handed_over' in blk and 'set total_factory_handed_over_g = v_new_handed_over' in blk
fn = fn[:a] + VAULT_ADD + '\n' + fn[b:]
out.append('\n-- ===== rpc_record_factory_gold_handover (from ' + src + ')\n' + fn + '\n')

fn, src = ORIG['rpc_reverse_factory_gold_handover']
a = fn.index('  -- Atomically recalculate obligation and advance:\n')
b = fn.index('  UPDATE public.factory_gold_handovers\n     SET status = \'reversed\',', a)
blk = fn[a:b]
assert 'GREATEST(0, v_vault.total_factory_handed_over_g - v_hnd.agreed_equivalent_g)' in blk and 'SET total_factory_handed_over_g = v_new_handed_over' in blk
fn = fn[:a] + '''  -- 091: the reversal gives back exactly the handover's 585 equivalent (never a silent clamp at 0)
  PERFORM public._goldia_vault_factory_add(v_caller_org, 0, -v_hnd.agreed_equivalent_g);
  SELECT current_factory_obligation_g, current_factory_advance_g INTO v_new_obligation, v_new_advance
    FROM public.manager_vault_account WHERE organization_id = v_caller_org;

''' + fn[b:]
out.append('\n-- ===== rpc_reverse_factory_gold_handover (from ' + src + ')\n' + fn + '\n')

fn, src = ORIG['_goldia_guard_finished_goods_handover']
fn = rep(fn, '''     and current_setting('goldia.fgr_reverse', true) is distinct from txid_current()::text then''',
         '''     and current_setting('goldia.fgr_reverse', true) is distinct from txid_current()::text
     -- 091: the financial restart (goldia.opening_write) and the staging test reset reverse everything at once
     and current_setting('goldia.opening_write', true) is distinct from txid_current()::text
     and current_setting('goldia.test_reset', true) is distinct from txid_current()::text then''')
out.append('\n-- ===== _goldia_guard_finished_goods_handover (from ' + src + ')\n' + fn + '\n')

fn, src = ORIG['rpc_financial_restart']
anchor = '''  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('purchases', v_n);
'''
fn = rep(fn, anchor, anchor + '''  -- 091: 090 goods returns and 091 seller LOM purchases are reversed with everything else
  insert into public.financial_restart_items select v_id, 'factory_goods_returns', id, status from public.factory_goods_returns where organization_id = v_org and status = 'confirmed';
  update public.factory_goods_returns set status = 'reversed', reversed_at = v_ts, reversal_reason = v_note where organization_id = v_org and status = 'confirmed';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('factory_goods_returns', v_n);
  insert into public.financial_restart_items select v_id, 'seller_lom_purchases', id, status from public.seller_lom_purchases where organization_id = v_org and status = 'confirmed';
  update public.seller_lom_purchases set status = 'reversed', reversed_at = v_ts, reversal_reason = v_note where organization_id = v_org and status = 'confirmed';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('seller_lom_purchases', v_n);
''')
out.append('\n-- ===== rpc_financial_restart (from ' + src + ')\n' + fn + '\n')

fn, src = ORIG['rpc_execute_full_test_reset']
fn = rep(fn, '''  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);
''', '''  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);
  perform set_config('goldia.test_reset', txid_current()::text, true); -- 091: lets the reset reverse finished-goods handovers
''')
fn = rep(fn, '''  get diagnostics v_purch_rev = row_count;
''', '''  get diagnostics v_purch_rev = row_count;
  -- 091: 090 goods returns and 091 seller LOM purchases
  update public.factory_goods_returns set status = 'reversed', reversed_at = now(), reversal_reason = v_rev_note
   where organization_id = v_caller_org and status = 'confirmed';
  update public.seller_lom_purchases set status = 'reversed', reversed_at = now(), reversal_reason = v_rev_note
   where organization_id = v_caller_org and status = 'confirmed';
''')
out.append('\n-- ===== rpc_execute_full_test_reset (from ' + src + ')\n' + fn + '\n')

fn, src = ORIG['_goldia_period_effects']
fn = rep(fn, '''  -- cash gold purchases
''', '''  -- 091: seller buys LOM with till UZS: till UZS down, till LOM (585) up - an exchange, not a collection / expense
  union all
  select 'seller_lom_purchase', x.purchase_date, x.seller_id, 1, 0, 0, 0, 0, -x.uzs_amount, 0, x.equiv_585_g, 0, 0, 0,
         x.physical_g, x.equiv_585_g, x.uzs_amount, x.price_per_g_uzs
    from public.seller_lom_purchases x where x.organization_id = p_org
  union all
  select 'reversal_seller_lom_purchase', public._goldia_business_date(x.reversed_at), x.seller_id, 1, 0, 0, 0, 0, x.uzs_amount, 0, -x.equiv_585_g, 0, 0, 0,
         x.physical_g, x.equiv_585_g, x.uzs_amount, x.price_per_g_uzs
    from public.seller_lom_purchases x where x.organization_id = p_org and x.status = 'reversed' and x.reversed_at is not null
  -- cash gold purchases
''')
out.append('\n-- ===== _goldia_period_effects (from ' + src + ')\n' + fn + '\n')

out.append(NEW.split('-- @@@ FUNCTIONS @@@')[1])
out.append("\nnotify pgrst, 'reload schema';\n")
dst = os.path.join(R, 'supabase/migrations/20260101000091_goldia_factory_handover_c2_fix_seller_lom_purchase.sql')
open(dst, 'w', encoding='utf-8').write(''.join(out))
print('written', dst, sum(1 for _ in open(dst, encoding='utf-8')))

# ---------------------------------------------------------------- rollback 091 (back to exactly 090)
rb = ['''-- Rollback of 091: back to exactly 090. Refused while a seller LOM purchase exists or a gold handover was booked by
-- the 091 rule after T0 (rolling back would bring the C2 defect back for future handovers - review first).
do $g$ begin
  if exists (select 1 from public.seller_lom_purchases) then raise exception 'ROLLBACK 091 REFUSED: seller LOM purchases exist'; end if;
end $g$;
drop function if exists public.rpc_record_seller_lom_purchase(numeric, numeric, text, numeric, numeric, uuid, date, text, text);
drop function if exists public.rpc_reverse_seller_lom_purchase(uuid, text, text);
''']
for n in CHANGED:
    if n in ('rpc_financial_restart', 'rpc_execute_full_test_reset', '_goldia_period_effects'):
        continue
    rb.append('\n' + ORIG[n][0] + '\n')
# the three functions that mention the new table go back before the table is dropped
for n in ('rpc_financial_restart', 'rpc_execute_full_test_reset', '_goldia_period_effects'):
    rb.append('\n' + ORIG[n][0] + '\n')
rb.append('''drop table if exists public.seller_lom_purchases;
notify pgrst, 'reload schema';
''')
open(os.path.join(R, 'supabase/rollback/20260101000091_rollback.sql'), 'w', encoding='utf-8').write(''.join(rb))
print('written rollback')
