#!/usr/bin/env python3
# Generates supabase/migrations/20260101000082_goldia_monthly_report_signed_balance.sql from the 073 body of
# rpc_get_customer_monthly_report (the latest definition) and its rollback (= the 073 body unchanged).
# Only the customer balance arithmetic changes; every existing output key keeps its name and meaning (open debt >= 0).
import re, pathlib
REPO = pathlib.Path(__file__).resolve().parents[3]
src = (REPO / "supabase/migrations/20260101000073_goldia_release_candidate_stabilization.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
start = src.index("CREATE OR REPLACE FUNCTION public.rpc_get_customer_monthly_report(")
end = src.index("$function$;", start) + len("$function$;")
body073 = src[start:end]
b = body073

def rep(old, new, count=1):
    global b
    n = b.count(old)
    assert n == count, (n, old[:90])
    b = b.replace(old, new)

rep("""  v_open_debt     numeric(14, 4);
  v_month_legacy  numeric(14, 4);""", """  v_open_debt     numeric(14, 4);
  v_open_net      numeric(14, 4);
  v_month_legacy  numeric(14, 4);
  v_month_legacy_adv numeric(14, 4);
  v_close_net     numeric(14, 4);
  v_close_adv     numeric(14, 4);
  v_open_adv      numeric(14, 4);""")
rep("""  v_tot_debt     numeric(14, 4) := 0;""", """  v_tot_debt     numeric(14, 4) := 0;
  v_tot_open_adv numeric(14, 4) := 0;
  v_tot_open_net numeric(14, 4) := 0;
  v_tot_legacy_adv numeric(14, 4) := 0;
  v_tot_close_adv numeric(14, 4) := 0;
  v_tot_close_net numeric(14, 4) := 0;""")
# opening: every unreversed legacy row, signed (debt rows +, advance rows -), no clamp
rep("""    -- 1. Opening debt: Legacy debts before start date + Sales before start date - Payments before start date
    select coalesce(sum(delta_585_g), 0) into v_open_debt
    from public.client_legacy_debts
    where customer_id = v_cust_rec.id
      and balance_type = 'debt'
      and as_of_date < v_start_date
      and status <> 'reversed';""", """    -- 1. Opening SIGNED balance (082): all legacy rows before the start (debt +, advance -) + sales - payments
    select coalesce(sum(delta_585_g), 0) into v_open_debt
    from public.client_legacy_debts
    where customer_id = v_cust_rec.id
      and as_of_date < v_start_date
      and status <> 'reversed';""")
rep("""    v_open_debt := round(greatest(0, v_open_debt), 4);""", """    v_open_net  := round(v_open_debt, 4);
    v_open_debt := greatest(0, v_open_net);
    v_open_adv  := greatest(0, -v_open_net);""")
rep("""    -- 2. Legacy debts registered in current month
    select coalesce(sum(delta_585_g), 0) into v_month_legacy
    from public.client_legacy_debts
    where customer_id = v_cust_rec.id
      and balance_type = 'debt'
      and as_of_date between v_start_date and v_end_date
      and status <> 'reversed';""", """    -- 2. Legacy entries registered in the month: debt rows (as before) and, separately, advance rows (082)
    select coalesce(sum(delta_585_g) filter (where balance_type = 'debt'), 0),
           coalesce(-sum(delta_585_g) filter (where balance_type = 'advance'), 0)
      into v_month_legacy, v_month_legacy_adv
    from public.client_legacy_debts
    where customer_id = v_cust_rec.id
      and as_of_date between v_start_date and v_end_date
      and status <> 'reversed';""")
rep("""    -- 5. Closing debt: opening + month legacy + sales - settled
    v_close_debt := round(greatest(0, (v_open_debt + v_month_legacy + v_month_sales) - v_month_settle), 4);

    if v_open_debt > 0 or v_month_legacy > 0 or v_month_sales > 0 or v_month_settle > 0 or v_close_debt > 0 then""",
"""    -- 5. Closing SIGNED balance (082): opening + month legacy debt - month legacy advance + sales - settled.
    --    closing_debt_g / closing_advance_g are its two sides; nothing is clamped away, the advance is subtracted once.
    v_close_net  := round(v_open_net + v_month_legacy - v_month_legacy_adv + v_month_sales - v_month_settle, 4);
    v_close_debt := greatest(0, v_close_net);
    v_close_adv  := greatest(0, -v_close_net);

    if v_open_net <> 0 or v_month_legacy <> 0 or v_month_legacy_adv <> 0 or v_month_sales <> 0 or v_month_settle <> 0 or v_close_net <> 0 then""")
rep("""        'opening_debt_g', v_open_debt,
        'legacy_added_month_g', v_month_legacy,""", """        'opening_debt_g', v_open_debt,
        'opening_advance_g', v_open_adv,
        'opening_net_g', v_open_net,
        'legacy_added_month_g', v_month_legacy,
        'legacy_advance_month_g', v_month_legacy_adv,""")
rep("""        'closing_debt_g', v_close_debt
      );""", """        'closing_debt_g', v_close_debt,
        'closing_advance_g', v_close_adv,
        'closing_net_g', v_close_net
      );""")
rep("""      v_tot_debt := v_tot_debt + v_close_debt;""", """      v_tot_debt := v_tot_debt + v_close_debt;
      v_tot_open_adv := v_tot_open_adv + v_open_adv;
      v_tot_open_net := v_tot_open_net + v_open_net;
      v_tot_legacy_adv := v_tot_legacy_adv + v_month_legacy_adv;
      v_tot_close_adv := v_tot_close_adv + v_close_adv;
      v_tot_close_net := v_tot_close_net + v_close_net;""")
rep("""      'total_closing_debt_g', v_tot_debt,
      'total_customer_debt_g', v_tot_debt,""", """      'total_closing_debt_g', v_tot_debt,
      'total_customer_debt_g', v_tot_debt,
      -- 082: the advance side and the signed totals (gross debt - gross advance)
      'total_opening_advance_g', v_tot_open_adv,
      'total_opening_net_g', v_tot_open_net,
      'total_legacy_advance_month_g', v_tot_legacy_adv,
      'total_closing_advance_g', v_tot_close_adv,
      'total_closing_net_g', v_tot_close_net,""")

head = """-- 082 — Goldia Sales: customer monthly report with SIGNED balances (critical display bug 2026-11-09).
-- Only rpc_get_customer_monthly_report changes (read-only report; signature, grants and every existing key unchanged).
-- Generated by docs/releases/production-075/gen-082-monthly-report.py from the 073 body.
--
-- Root cause (073): opening and closing were clamped with greatest(0, ...) and legacy ADVANCE rows
-- (client_legacy_debts.balance_type = 'advance') were left out completely. A customer with an advance therefore
-- showed too much debt, and a month that started with an advance lost it (closing overstated). Staging 2026-11-09:
-- 107 of 649 customers wrong, total closing 8 924.0326 g against a live gross debt of 8 560.3391 g.
-- Now: opening / closing are signed (debt +, advance -) over ALL unreversed legacy rows, sales and payments;
-- opening_debt_g / closing_debt_g stay the open debt (>= 0) and the new *_advance_g / *_net_g keys carry the rest.
-- Totals: total_closing_debt_g = gross debt, total_closing_advance_g = gross advance,
-- total_closing_net_g = gross debt - gross advance. No balance, history or document is changed.

"""
grant = """

revoke execute on function public.rpc_get_customer_monthly_report(uuid, integer, integer) from public, anon;
grant execute on function public.rpc_get_customer_monthly_report(uuid, integer, integer) to authenticated, service_role;
"""
(REPO / "supabase/migrations/20260101000082_goldia_monthly_report_signed_balance.sql").write_text(head + b + grant, encoding="utf-8")
(REPO / "supabase/rollback/20260101000082_rollback.sql").write_text(
    "-- Rollback of 082: restores the 073 body of rpc_get_customer_monthly_report (clamped, debt-type legacy only).\n\n" + body073 + grant, encoding="utf-8")
print("ok", len(b))
