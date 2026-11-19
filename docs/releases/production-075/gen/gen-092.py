"""Generates supabase/migrations/20260101000092_goldia_old_sale_return_without_opening_debt.sql and its rollback from
the CURRENT bodies (newest definition in migrations <= 091: exact copies + asserted replacements).
Run: python3 -I gen-092.py"""
import os, re, glob
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..')
MIG = [m for m in sorted(glob.glob(os.path.join(R, 'supabase/migrations/2026010100*.sql'))) if os.path.basename(m) < '20260101000092']


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


CHANGED = ['_goldia_opening_return_calc', 'rpc_record_opening_sale_return', 'rpc_get_unified_customer_ledger']
ORIG = {n: latest(n) for n in CHANGED}

out = ['''-- 092 - Goldia Sales (2026-11-19), on top of 091: old-sale return (089) without an opening debt.
-- Rule (owner): the 585 value of the returned goods first lowers THIS customer's old (opening) debt, then his new debt,
-- the rest becomes his advance; an old debt of 0 (or no opening debt document at all) does not block the return.
-- 089 already applied that order when an opening debt document existed (opening_part -> rest of the debt -> advance);
-- it refused the return when the customer had no opening debt document of that unit (ERR_NO_OPENING_DEBT). 092:
--   * no opening debt document: old part 0, the value goes to the new debt, the rest to the advance; the goods belong
--     to the customer's own seller and, without a documented old obligation, go to the manager (seller keep refused -
--     no obligation is invented); the seller's obligation does not change;
--   * opening_sale_returns.new_debt_part (stored, = debt_reduced - opening_part): old / new / advance parts are kept apart;
--   * the customer ledger shows the parts where they belong (old column - old part only; sales - new part; advance part
--     on the paid side): the net balance is exactly the same as before, only the split is right.
-- No business row changes; opening documents (LOCK) untouched.
alter table public.opening_sale_returns alter column opening_document_id drop not null;
alter table public.opening_sale_returns add column if not exists new_debt_part numeric(18, 4) generated always as (debt_reduced - opening_part) stored;
''']

# ---------------------------------------------------------------- the calculation
fn, src = ORIG['_goldia_opening_return_calc']
fn = rep(fn, '''  v_formula text;
begin''', '''  v_formula text;
  v_seller  uuid;           -- 092: the opening document's seller, or (no document) the customer's own seller
  v_ret_amt numeric(18, 4) := 0;
  v_ret_rel numeric(14, 4) := 0;
begin''')
a = fn.index('''  if v_doc.id is null then
    raise exception 'ERR_NO_OPENING_DEBT''')
b = fn.index('''  select * into v_ret from public._goldia_opening_returned(v_doc.id);
''', a) + len('''  select * into v_ret from public._goldia_opening_returned(v_doc.id);
''')
fn = fn[:a] + '''  if v_doc.id is null then
    -- 092: no (confirmed) opening debt of this unit does NOT block the return: old part 0, the value lowers the new debt,
    -- the rest becomes an advance; the goods are the customer's own seller's
    select c.seller_id into v_seller from public.customers c where c.id = p_customer and c.organization_id = p_org;
    if v_seller is null then raise exception 'ERR_CUSTOMER_NO_SELLER: mijozga sotuvchi biriktirilmagan' using errcode = '22023'; end if;
  else
    if v_doc.seller_id is null then raise exception 'Boshlang''ich qarz sotuvchiga biriktirilmagan' using errcode = '22023'; end if;
    v_seller := v_doc.seller_id;
    select * into v_ret from public._goldia_opening_returned(v_doc.id);
    v_ret_amt := coalesce(v_ret.amount, 0); v_ret_rel := coalesce(v_ret.released_g, 0);
  end if;
''' + fn[b:]
fn = rep(fn, 'v_rem := least(v_doc.amount - v_ret.amount, v_leg - v_ret.amount);',
         'v_rem := case when v_doc.id is null then 0 else least(v_doc.amount - v_ret_amt, v_leg - v_ret_amt) end;')
fn = rep(fn, '''    v_rem := v_doc.amount - coalesce((select sum(coalesce(c.opening_applied_amount, c.applied_to_debt)) from public.client_currency_settlements c
                                        where c.opening_document_id = v_doc.id and c.status <> 'reversed'), 0) - v_ret.amount;''',
         '''    v_rem := case when v_doc.id is null then 0 else
             v_doc.amount - coalesce((select sum(coalesce(c.opening_applied_amount, c.applied_to_debt)) from public.client_currency_settlements c
                                        where c.opening_document_id = v_doc.id and c.status <> 'reversed'), 0) - v_ret_amt end;''')
fn = rep(fn, '- v_ret.released_g);', '- v_ret_rel);')
fn = rep(fn, '''               || '; boshlang''ich qarz qismi ' || v_open || '; hujjatdagi eski sotuvchi majburiyati ' || v_rel || ' g';''',
         '''               || '; eski (boshlang''ich) qarzdan ' || v_open || ', yangi qarzdan ' || (v_debt - v_open)
               || case when v_doc.id is null then ' (boshlang''ich qarz hujjati yo''q)' else '' end
               || '; hujjatdagi eski sotuvchi majburiyati ' || v_rel || ' g';''')
fn = rep(fn, "'opening_document_no', v_doc.document_no, 'seller_id', v_doc.seller_id,",
         "'opening_document_no', v_doc.document_no, 'seller_id', v_seller,")
fn = rep(fn, "'opening_remaining', v_rem, 'opening_part', v_open,",
         "'opening_remaining', v_rem, 'opening_part', v_open, 'new_debt_part', v_debt - v_open, 'has_opening_document', v_doc.id is not null,")
out.append('\n-- ===== _goldia_opening_return_calc (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- the record: lot note without a document number
fn, src = ORIG['rpc_record_opening_sale_return']
fn = rep(fn, """'ESKI SAVDODAN VOZVRAT ' || v_no || ' (' || (v_c ->> 'opening_document_no') || ')', clock_timestamp())""",
         """'ESKI SAVDODAN VOZVRAT ' || v_no || ' (' || coalesce(v_c ->> 'opening_document_no', 'boshlang''ich qarz hujjatisiz') || ')', clock_timestamp())""")
out.append('\n-- ===== rpc_record_opening_sale_return (from ' + src + ')\n' + fn + '\n')

# ---------------------------------------------------------------- the customer ledger: the parts where they belong
fn, src = ORIG['rpc_get_unified_customer_ledger']
fn = rep(fn, '  v_old_ret_g      numeric(14, 4);\n', '  v_old_ret_g      numeric(14, 4);\n  v_ret_old        numeric(14, 4);\n  v_ret_new        numeric(14, 4);\n  v_ret_adv        numeric(14, 4);\n')
fn = rep(fn, '''    select coalesce(sum(credit_amount), 0) into v_old_ret_g from public.opening_sale_returns
     where customer_id = v_cust_rec.id and organization_id = v_caller_org and status = 'confirmed' and unit = 'G585';
    v_legacy_debt := round(v_legacy_debt - v_old_ret_g, 4);''',
         '''    -- 092: as booked - the old part off the old balance, the new-debt part off the sales, the advance part on the paid
    --      side below (the net is unchanged; the old column never shows more than was really old)
    select coalesce(sum(credit_amount), 0), coalesce(sum(opening_part), 0), coalesce(sum(new_debt_part), 0), coalesce(sum(advance_created), 0)
      into v_old_ret_g, v_ret_old, v_ret_new, v_ret_adv from public.opening_sale_returns
     where customer_id = v_cust_rec.id and organization_id = v_caller_org and status = 'confirmed' and unit = 'G585';
    v_legacy_debt := round(v_legacy_debt - v_ret_old, 4);
    v_gross_sales := round(v_gross_sales - v_ret_new, 4);''')
a = fn.index('    -- Gross obligation combining sales and legacy debt\n')
b = fn.index('    -- Applied Advance\n', a)
blk = fn[a:b]
assert blk.count('v_total_paid') == 6, blk.count('v_total_paid')
blk = blk.replace('v_total_paid', '(v_total_paid + v_ret_adv)')
fn = fn[:a] + blk + fn[b:]
out.append('\n-- ===== rpc_get_unified_customer_ledger (from ' + src + ')\n' + fn + '\n')
out.append("\nnotify pgrst, 'reload schema';\n")
dst = os.path.join(R, 'supabase/migrations/20260101000092_goldia_old_sale_return_without_opening_debt.sql')
open(dst, 'w', encoding='utf-8').write(''.join(out))
print('written', dst, sum(1 for _ in open(dst, encoding='utf-8')))

rb = ['''-- Rollback of 092: back to exactly 091. Refused once an old-sale return without an opening debt document exists.
do $g$ begin
  if exists (select 1 from public.opening_sale_returns where opening_document_id is null) then
    raise exception 'ROLLBACK 092 REFUSED: old-sale returns without an opening debt document exist';
  end if;
end $g$;
''']
for n in CHANGED:
    rb.append('\n' + ORIG[n][0] + '\n')
rb.append('''alter table public.opening_sale_returns drop column if exists new_debt_part;
alter table public.opening_sale_returns alter column opening_document_id set not null;
notify pgrst, 'reload schema';
''')
open(os.path.join(R, 'supabase/rollback/20260101000092_rollback.sql'), 'w', encoding='utf-8').write(''.join(rb))
print('written rollback')
