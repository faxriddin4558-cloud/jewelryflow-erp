"""Generates supabase/migrations/20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql and its
rollback from the CURRENT bodies (newest definition in migrations <= 089: exact copies + asserted replacements) and
sql-090-new.sql. Run: python3 -I gen-090.py"""
import os, re, glob
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..')
MIG = [m for m in sorted(glob.glob(os.path.join(R, 'supabase/migrations/2026010100*.sql'))) if os.path.basename(m) < '20260101000090']


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


CHANGED = ['rpc_issue_barcode_consignment', 'rpc_return_piece_to_manager', 'rpc_reverse_barcode_consignment',
           '_goldia_period_effects', 'rpc_get_seller_stock_movements']
ORIG = {n: latest(n) for n in CHANGED}
here = os.path.dirname(os.path.abspath(__file__))
NEW = open(os.path.join(here, 'sql-090-new.sql'), encoding='utf-8').read()

out = ['''-- 090 - Goldia Sales (2026-11-19): one final package on top of 089. Nothing existing is rewritten in place; opening
-- documents (LOCK), 088 / 089 rules, payments, handovers and factory accounts keep every row.
--
-- 1. Consignment cancellation (rpc_reverse_barcode_consignment, unchanged since 039):
--    * a FIFO consignment can take goods from several factory receipts (e.g. an opening A receipt and a later one),
--      but only the first receipt was remembered: a cancellation put ALL grams back on that receipt (its available
--      grams could exceed what it ever had). Now every issue records consignment_receipt_allocations and a
--      cancellation / a returned piece goes back to exactly those receipts (newest first). A legacy consignment
--      without allocations is restored to its receipt only up to what that receipt gave out; anything more STOPS
--      (manual review) - nothing is guessed.
--    * the restored weight was base - returned although base is already net of returns: now the held pieces' grams.
--    * a cancellation marked the pieces "returned_to_manager" AND cancelled the consignment, so the period report and
--      the 089 stock movements took the grams off the seller TWICE (consignment_cancelled + return_to_manager). The
--      pieces are now "cancelled"; historic cancellations (same timestamp) are no longer counted twice.
--    * the seller's account is recalculated and the manager stock refreshed; an opening B consignment (LOCK), a 089
--      old-sale return lot (own reversal) and a consignment without factory receipt are refused.
-- 2. Manager -> factory goods return (factory_goods_returns, rpc_return_goods_to_factory / reverse): partial or full
--    grams of ONE factory receipt (opening A or later), valued at that receipt's own factory % (088 rule: grams x
--    (1 + A %)): manager stock - grams, factory net - value (booked as handed over, so an existing factory advance
--    grows correctly). Seller obligations, customer debts and profit are not touched. Pieces without a factory
--    receipt are not accepted (no approved rule). Idempotent, audited, reversible, in the period report.
-- 3. A seller cancelling his own sale: new sales remember who recorded them (jewelry_sales.recorded_by); a seller
--    may cancel only a sale that is his AND that he recorded, with a reason, while no payment / advance of that
--    customer came after it and its date is not inside a closed report period. Other cases go through the manager's
--    existing reversal. The existing reversal functions do the work (atomic, row locks, double-cancel refused).
''', NEW.split('-- @@@ FUNCTIONS @@@')[0]]

# ---------------------------------------------------------------- consignment issue: remember every receipt it takes
fn, src = ORIG['rpc_issue_barcode_consignment']
fn = rep(fn, '''  v_take_g            numeric(14, 4) := 0;''', '''  v_take_g            numeric(14, 4) := 0;
  v_alloc             jsonb := '[]'::jsonb; -- 090: grams taken from each factory receipt''')
fn = rep(fn, '''           status = CASE WHEN ROUND((available_physical_g - v_total_base_weight)::numeric, 4) <= 0.0001 THEN 'fully_transferred' ELSE 'partially_transferred' END,
           updated_at = NOW()
     WHERE id = v_receipt_id;''', '''           status = CASE WHEN ROUND((available_physical_g - v_total_base_weight)::numeric, 4) <= 0.0001 THEN 'fully_transferred' ELSE 'partially_transferred' END,
           updated_at = NOW()
     WHERE id = v_receipt_id;
    v_alloc := jsonb_build_array(jsonb_build_object('r', v_receipt_id, 'g', v_total_base_weight));''')
fn = rep(fn, '''             status = CASE WHEN ROUND((available_physical_g - v_take_g)::numeric, 4) <= 0.0001 THEN 'fully_transferred' ELSE 'partially_transferred' END,
             updated_at = NOW()
       WHERE id = v_cur_receipt.id;''', '''             status = CASE WHEN ROUND((available_physical_g - v_take_g)::numeric, 4) <= 0.0001 THEN 'fully_transferred' ELSE 'partially_transferred' END,
             updated_at = NOW()
       WHERE id = v_cur_receipt.id;
      IF v_take_g > 0 THEN v_alloc := v_alloc || jsonb_build_object('r', v_cur_receipt.id, 'g', v_take_g); END IF;''')
fn = rep(fn, '''  ) RETURNING id INTO v_consignment_id;''', '''  ) RETURNING id INTO v_consignment_id;
  INSERT INTO public.consignment_receipt_allocations (organization_id, consignment_id, factory_receipt_id, grams, seq)
  SELECT v_caller_org, v_consignment_id, (x.e ->> 'r')::uuid, (x.e ->> 'g')::numeric, x.n
    FROM jsonb_array_elements(v_alloc) WITH ORDINALITY AS x(e, n);''')
out.append('\n-- ===== rpc_issue_barcode_consignment (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- a returned piece goes back to its own receipt(s)
fn, src = ORIG['rpc_return_piece_to_manager']
fn = rep(fn, '''  IF v_consign.factory_receipt_id IS NOT NULL THEN
    UPDATE public.factory_receipts
       SET available_physical_g = ROUND((available_physical_g + v_piece.weight_grams)::numeric, 4),
           status = CASE
                      WHEN ROUND((available_physical_g + v_piece.weight_grams)::numeric, 4) >= original_physical_g THEN 'in_manager_stock'
                      ELSE 'partially_transferred'
                    END,
           updated_at = NOW()
     WHERE id = v_consign.factory_receipt_id;
  END IF;''', '''  -- 090: back to the receipt(s) the consignment really took the goods from (never above what a receipt gave out)
  IF v_consign.factory_receipt_id IS NOT NULL THEN
    PERFORM public._goldia_restore_consignment_receipts(v_consign.id, v_piece.weight_grams, false);
  END IF;''')
out.append('\n-- ===== rpc_return_piece_to_manager (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- period effects: factory goods returns, no double count
fn, src = ORIG['_goldia_period_effects']
fn = rep(fn, '''    from public.consignment_pieces p where p.organization_id = p_org and p.returned_to_manager_at is not null
  -- factory''', '''    from public.consignment_pieces p where p.organization_id = p_org and p.returned_to_manager_at is not null
     -- 090: pieces put back by a consignment CANCELLATION (same timestamp) are already in consignment_cancelled
     and not exists (select 1 from public.seller_consignments c where c.id = p.consignment_id and c.status = 'cancelled' and c.cancelled_at = p.returned_to_manager_at)
  -- 090: a manager -> factory goods return is booked as a factory_gold_handovers row (source finished_goods_return),
  -- so it is already in the factory_handover / reversal_factory_handover rows below (no extra row: no double count)
  -- factory''')
out.append('\n-- ===== _goldia_period_effects (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- 089 stock movements: same double count
fn, src = ORIG['rpc_get_seller_stock_movements']
fn = rep(fn, '''      from public.consignment_pieces p where p.organization_id = v_org and p.returned_to_manager_at is not null''',
         '''      from public.consignment_pieces p where p.organization_id = v_org and p.returned_to_manager_at is not null
       -- 090: pieces put back by a consignment cancellation are already in consignment_cancelled
       and not exists (select 1 from public.seller_consignments c where c.id = p.consignment_id and c.status = 'cancelled' and c.cancelled_at = p.returned_to_manager_at)''')
fn = rep(fn, '''    select c.seller_id, public._goldia_business_date(c.cancelled_at), c.cancelled_at, 'consignment_cancelled', c.consignment_no, -c.base_weight_grams, c.id
      from public.seller_consignments c where c.organization_id = v_org and c.status = 'cancelled' and c.cancelled_at is not null''',
         '''    select c.seller_id, public._goldia_business_date(c.cancelled_at), c.cancelled_at, 'consignment_cancelled', c.consignment_no, -c.base_weight_grams, c.id
      from public.seller_consignments c where c.organization_id = v_org and c.status = 'cancelled' and c.cancelled_at is not null
       and c.base_weight_grams > 0''')
out.append('\n-- ===== rpc_get_seller_stock_movements (from ' + src + ')\n' + fn + '\n')

out.append(NEW.split('-- @@@ FUNCTIONS @@@')[1])
out.append("\nnotify pgrst, 'reload schema';\n")
dst = os.path.join(R, 'supabase/migrations/20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql')
open(dst, 'w', encoding='utf-8').write(''.join(out))
print('written', dst, sum(1 for _ in open(dst, encoding='utf-8')))

# ---------------------------------------------------------------- rollback 090 (back to exactly 089)
rb = ['''-- Rollback of 090: back to exactly 089. Refused once a factory goods return or a seller-cancel decision depends on
-- 090 (a goods return exists).
do $g$ begin
  if exists (select 1 from public.factory_goods_returns) then raise exception 'ROLLBACK 090 REFUSED: factory goods returns exist'; end if;
  if exists (select 1 from public.sale_edits) then raise exception 'ROLLBACK 090 REFUSED: sale edits exist'; end if;
end $g$;
do $g2$ begin
  if exists (select 1 from public.factory_gold_handovers where source_type = 'finished_goods_return') then raise exception 'ROLLBACK 090 REFUSED: finished-goods handovers exist'; end if;
end $g2$;
drop trigger if exists trg_goldia_guard_finished_goods_handover on public.factory_gold_handovers;
drop function if exists public._goldia_guard_finished_goods_handover();
alter table public.factory_gold_handovers drop constraint if exists factory_gold_handovers_source_type_check;
alter table public.factory_gold_handovers add constraint factory_gold_handovers_source_type_check
  check (source_type in ('capital_pure_gold', 'refined_gold', 'purchased_gold', 'scrap_gold'));
drop trigger if exists trg_goldia_guard_seller_sale_cancel on public.jewelry_sales;
drop function if exists public._goldia_guard_seller_sale_cancel();
drop function if exists public.rpc_return_goods_to_factory(uuid, numeric, text, text);
drop function if exists public.rpc_reverse_factory_goods_return(uuid, text, text);
drop function if exists public.rpc_edit_client_sale(uuid, text, text, numeric, numeric, uuid, uuid[], numeric);
''']
for n in CHANGED:
    rb.append('\n' + ORIG[n][0] + '\n')
rb.append('''
drop function if exists public._goldia_restore_consignment_receipts(uuid, numeric, boolean);
drop table if exists public.sale_edits;
drop table if exists public.factory_goods_returns;
drop table if exists public.consignment_receipt_allocations;
alter table public.jewelry_sales drop column if exists recorded_by;
notify pgrst, 'reload schema';
''')
open(os.path.join(R, 'supabase/rollback/20260101000090_rollback.sql'), 'w', encoding='utf-8').write(''.join(rb))
print('written rollback')
