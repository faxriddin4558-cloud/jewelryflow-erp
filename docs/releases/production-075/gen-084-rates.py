#!/usr/bin/env python3
# Generates supabase/migrations/20260101000084_goldia_operation_rates_and_currency_valuation.sql and its rollback from
# the LATEST repository bodies (exact, asserted patches; nothing else in those bodies moves).
import re, glob, pathlib
REPO = pathlib.Path(__file__).resolve().parents[3]
FILES = [f for f in sorted(glob.glob(str(REPO / "supabase/migrations/*.sql"))) if "20260101000084_" not in f]

def latest(fn):
    body = src = None
    for f in FILES:
        s = pathlib.Path(f).read_text(encoding="utf-8").replace("\r\n", "\n")
        for m in re.finditer(r"create\s+or\s+replace\s+function\s+public\." + re.escape(fn) + r"\s*\(", s, re.I):
            st = m.start()
            tag = re.search(r"\bas\s+(\$[a-z_]*\$)", s[st:st + 4000], re.I).group(1)
            e = s.find(tag, s.find(tag, st) + len(tag)) + len(tag)
            body, src = s[st:e], pathlib.Path(f).name
    assert body, fn
    return body, src

def patch(body, pairs, fn):
    for old, new in pairs:
        n = body.count(old)
        assert n == 1, (fn, n, old[:120])
        body = body.replace(old, new)
    return body

P = {}
# ------------------------------------------------------------------ customer 585 payment
P["rpc_record_client_settlement"] = [
("""    select * into v_seller_rate from public.seller_rates
     where seller_id = v_caller_emp_id and organization_id = v_caller_org
     for share;
    v_rate := coalesce(v_seller_rate.lom_rate_uzs, v_official_rate);  -- no own LOM rate: official rate (pre-072 rule)
    if v_rate is null or v_rate <= 0 then
      raise exception 'ERR_DAILY_RATE_NOT_SET: LOM kursingiz belgilanmagan. Avval o''z kursingizni kiriting.';
    end if;
    if p_rate_per_gram is not null and p_rate_per_gram > 0 and abs(round(p_rate_per_gram::numeric, 2) - v_rate) > 0.01 then
      raise exception 'ERR_RATE_MISMATCH: Sizning joriy LOM kursingiz % UZS/g. Yuborilgan kurs: % UZS/g. Sahifani yangilang.',
        v_rate, p_rate_per_gram using errcode = '42501';
    end if;
    if v_usd > 0 then
      if v_seller_rate.usd_rate_uzs is null then
        raise exception 'ERR_USD_RATE_NOT_SET: Dollar qabul qilish uchun avval o''z USD kursingizni belgilang.';
      end if;
      if p_usd_rate is not null and p_usd_rate > 0 and abs(round(p_usd_rate::numeric, 2) - v_seller_rate.usd_rate_uzs) > 0.01 then
        raise exception 'ERR_RATE_MISMATCH: Sizning joriy USD kursingiz % UZS. Yuborilgan kurs: % UZS. Sahifani yangilang.',
          v_seller_rate.usd_rate_uzs, p_usd_rate using errcode = '42501';
      end if;
      v_own_usd_rate := v_seller_rate.usd_rate_uzs;
    end if;""",
"""    select * into v_seller_rate from public.seller_rates
     where seller_id = v_caller_emp_id and organization_id = v_caller_org
     for share;
    -- 084: the rate is entered per payment; default = the seller's saved rate (else the official rate); any value
    -- inside the organization's limits is accepted and snapshotted on the payment (no forced official / saved rate)
    v_rate := public._goldia_operation_rate(v_caller_org, 'lom', v_caller_role, p_rate_per_gram, coalesce(v_seller_rate.lom_rate_uzs, v_official_rate));
    if v_usd > 0 then
      v_own_usd_rate := public._goldia_operation_rate(v_caller_org, 'usd', v_caller_role, p_usd_rate, v_seller_rate.usd_rate_uzs);
    end if;"""),
("""    if p_rate_per_gram is not null and p_rate_per_gram > 0 then
      v_rate := round(p_rate_per_gram::numeric, 2);
    else
      v_rate := v_official_rate;
    end if;
    perform public._goldia_assert_seller_rate(v_caller_role, v_rate, v_official_rate, (v_cash > 0 or v_usd > 0));""",
"""    -- 084: director / manager: entered rate, default the official rate; required only when cash / USD is converted
    if v_cash > 0 or v_usd > 0 then
      v_rate := public._goldia_operation_rate(v_caller_org, 'lom', v_caller_role, p_rate_per_gram, v_official_rate);
    end if;"""),
("""    elsif p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) to''lovini hisoblash uchun USD kursi (CBU yoki qo''lda) kiritilishi shart!';""",
"""    elsif p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := public._goldia_operation_rate(v_caller_org, 'usd', v_caller_role, p_usd_rate, null);
    else
      raise exception 'ERR_RATE_REQUIRED: Dollar (USD) to''lovi uchun USD kursini kiriting';"""),
]
# ------------------------------------------------------------------ customer UZS / USD payment
P["rpc_record_client_currency_settlement"] = [(
"""  if v_is_seller then
    select * into v_rates from public.seller_rates where seller_id = v_caller_emp_id and organization_id = v_caller_org for share;
    if v_need_usd_rate then
      if v_rates.usd_rate_uzs is null then
        raise exception 'ERR_USD_RATE_NOT_SET: Valyutani almashtirish uchun avval o''z USD kursingizni belgilang.';
      end if;
      if p_usd_rate is not null and p_usd_rate > 0 and abs(round(p_usd_rate::numeric, 2) - v_rates.usd_rate_uzs) > 0.01 then
        raise exception 'ERR_RATE_MISMATCH: Sizning joriy USD kursingiz % UZS. Yuborilgan kurs: % UZS. Sahifani yangilang.', v_rates.usd_rate_uzs, p_usd_rate using errcode = '42501';
      end if;
      v_usd_rate := v_rates.usd_rate_uzs;
    end if;
    if v_scrap > 0 then
      v_lom_rate := coalesce(v_rates.lom_rate_uzs, public._goldia_official_585_rate(v_caller_org));
      if v_lom_rate is null or v_lom_rate <= 0 then
        raise exception 'ERR_DAILY_RATE_NOT_SET: LOM kursingiz belgilanmagan. Avval o''z kursingizni kiriting.';
      end if;
      if p_lom_rate is not null and p_lom_rate > 0 and abs(round(p_lom_rate::numeric, 2) - v_lom_rate) > 0.01 then
        raise exception 'ERR_RATE_MISMATCH: Sizning joriy LOM kursingiz % UZS/g. Yuborilgan kurs: % UZS/g. Sahifani yangilang.', v_lom_rate, p_lom_rate using errcode = '42501';
      end if;
    end if;
  else
    if v_need_usd_rate then
      if p_usd_rate is null or p_usd_rate <= 0 then
        raise exception 'ERR_RATE_REQUIRED: Boshqa valyutadagi to''lov uchun USD kursini kiriting';
      end if;
      v_usd_rate := round(p_usd_rate::numeric, 2);
    end if;
    if v_scrap > 0 then
      if p_lom_rate is null or p_lom_rate <= 0 then
        raise exception 'ERR_RATE_REQUIRED: Lom bilan to''lov uchun LOM (585) kursini kiriting';
      end if;
      v_lom_rate := round(p_lom_rate::numeric, 2);
    end if;
  end if;""",
"""  -- 084: every role enters the rates of this payment; defaults: a seller's saved rates (LOM: else the official rate),
  -- director / manager: the official LOM rate, USD has no default for them. Snapshotted on the payment.
  if v_is_seller then
    select * into v_rates from public.seller_rates where seller_id = v_caller_emp_id and organization_id = v_caller_org for share;
  end if;
  if v_need_usd_rate then
    v_usd_rate := public._goldia_operation_rate(v_caller_org, 'usd', v_caller_role, p_usd_rate,
                    case when v_is_seller then v_rates.usd_rate_uzs end);
  end if;
  if v_scrap > 0 then
    v_lom_rate := public._goldia_operation_rate(v_caller_org, 'lom', v_caller_role, p_lom_rate,
                    case when v_is_seller then coalesce(v_rates.lom_rate_uzs, public._goldia_official_585_rate(v_caller_org))
                         else public._goldia_official_585_rate(v_caller_org) end);
  end if;""")]
# ------------------------------------------------------------------ seller -> manager handover
P["rpc_record_seller_to_manager_settlement"] = [
("""  v_rate_applied    numeric(18, 2);""", """  v_rate_applied    numeric(18, 2);
  v_srates          public.seller_rates%rowtype;"""),
("""  v_official_rate := public._goldia_official_585_rate(v_org_id);
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    v_rate := v_official_rate;
  end if;
  if (v_leg_cash > 0 or v_leg_usd > 0) and (v_rate is null or v_rate <= 0) then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Bugungi 585 oltin kursi belgilanmagan! Naqd pul topshirish uchun avval kunlik kursni kiriting.';
  end if;
  -- a rate the seller sends must still be the official one (065), even when the captured value is used
  perform public._goldia_assert_seller_rate(v_caller_role, v_rate, v_official_rate,
    (v_leg_cash > 0 or v_leg_usd > 0) or ((v_cash > 0 or v_usd > 0) and p_rate_per_gram is not null and p_rate_per_gram > 0));
  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0; -- Safe sentinel rate for DB check constraint (gold_rate_applied > 0) when cash is 0
  end if;
  -- 5. USD Rate determination (only the pre-072 USD needs a rate now)
  if v_leg_usd > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) topshirish uchun USD kursi kiritilishi shart!';
    end if;
  else
    v_usd_rate := null;
  end if;""",
"""  -- 084: only cash / USD WITHOUT a captured gram value (e.g. money of UZS / USD sales) needs a rate; it is entered
  -- for this handover by any role (default: the official rate, else the seller's saved rate) inside the limits, and
  -- snapshotted on the handover. Valued cash keeps the grams captured at payment time - the rate does not touch it.
  v_official_rate := public._goldia_official_585_rate(v_org_id);
  select * into v_srates from public.seller_rates where seller_id = p_seller_id and organization_id = v_org_id;
  if v_leg_cash > 0 or v_leg_usd > 0 then
    v_rate := public._goldia_operation_rate(v_org_id, 'lom', v_caller_role, p_rate_per_gram, coalesce(v_official_rate, v_srates.lom_rate_uzs));
  else
    v_rate := null;
  end if;
  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0; -- placeholder for the DB check (gold_rate_applied > 0) when no cash is converted; never used in a calculation
  end if;
  -- 5. USD rate (only dollars without a captured value)
  if v_leg_usd > 0 then
    v_usd_rate := public._goldia_operation_rate(v_org_id, 'usd', v_caller_role, p_usd_rate, v_srates.usd_rate_uzs);
  else
    v_usd_rate := null;
  end if;"""),
# 084 (business decision confirmed 2026-11-10): keep the rate the operator actually used for the unvalued money as its
# own snapshot - gold_rate_applied stays the effective UZS per gram of the whole handover (unchanged 072 meaning)
("""    till_pool_usd_585_g,
    applied_to_debt_grams,""", """    till_pool_usd_585_g,
    handover_entered_lom_rate,
    applied_to_debt_grams,"""),
("""    v_val_usd_g,
    v_total_settled,
    0,""", """    v_val_usd_g,
    case when v_leg_cash > 0 or v_leg_usd > 0 then v_rate end,
    v_total_settled,
    0,"""),
("""    'applied_rate_per_gram', v_rate_applied,""", """    'applied_rate_per_gram', v_rate_applied,
    'entered_lom_rate', case when v_leg_cash > 0 or v_leg_usd > 0 then v_rate end,"""),
]
# ------------------------------------------------------------------ capital / expenses: no 880 000 / 12 800 fallback
P["rpc_record_financial_transaction"] = [
("""    v_rate_585 := coalesce(v_rate_585, 880000);""",
 """    -- 084: no guessed rate (was 880 000); a money amount without any rate is refused below"""),
("""    v_rate_usd := coalesce(v_rate_usd, 12800); -- only reached for non-USD amounts (stored for reference)""",
 """    -- 084: no guessed USD rate (was 12 800); non-USD amounts store NULL"""),
("""  -- 585 Gold Equivalent Calculation
  if v_cur in ('UZS', 'CASH_UZS') then""",
 """  -- 585 Gold Equivalent Calculation
  if v_cur in ('UZS', 'CASH_UZS', 'USD', 'CASH_USD') and (v_rate_585 is null or v_rate_585 <= 0) then
    raise exception 'ERR_RATE_REQUIRED: Pul summasini 585 grammga aylantirish uchun 585 kursini kiriting (p_gold_rate)';
  end if;
  if v_cur in ('UZS', 'CASH_UZS') then"""),
]
# ------------------------------------------------------------------ seller -> factory cash: no 900 000 fallback
P["rpc_record_seller_to_factory_settlement"] = [(
"""    if v_rate is null or v_rate <= 0 then
      v_rate := 900000;
    end if;""",
"""    if v_rate is null or v_rate <= 0 then
      -- 084: no guessed rate (was 900 000)
      if v_cash > 0 then
        raise exception 'ERR_RATE_REQUIRED: Naqd pulni zavodga topshirish uchun 585 kursini kiriting';
      end if;
      v_rate := 1.0; -- placeholder for the DB check when no cash is converted; never used in a calculation
    end if;""")]
# ------------------------------------------------------------------ historical import: a row without a rate is skipped, not guessed
P["rpc_execute_sheets_historical_import"] = [
("""        v_rate := coalesce((v_row ->> 'rate_per_g')::numeric, 900000);""",
 """        v_rate := nullif((v_row ->> 'rate_per_g')::numeric, 0);  -- 084: no guessed 900 000"""),
("""        if v_weight > 0 and v_cash > 0 then
          v_purchase_no := 'IMP-BUY-'""",
 """        if v_weight > 0 and v_cash > 0 and v_rate is not null and v_rate > 0 then
          v_purchase_no := 'IMP-BUY-'"""),
]
# ------------------------------------------------------------------ profit summary: currency receivables, no guessed USD
P["rpc_get_accounting_profit_summary"] = [
("""  v_period_accounting_res  numeric(14, 4) := null;""", """  v_period_accounting_res  numeric(14, 4) := null;
  v_cur_uzs_debt           numeric(18, 2) := 0;
  v_cur_uzs_adv            numeric(18, 2) := 0;
  v_cur_usd_debt           numeric(18, 2) := 0;
  v_cur_usd_adv            numeric(18, 2) := 0;
  v_cur_uzs_debt_g         numeric(14, 4) := 0;
  v_cur_uzs_adv_g          numeric(14, 4) := 0;
  v_cur_usd_debt_g         numeric(14, 4) := 0;
  v_cur_usd_adv_g          numeric(14, 4) := 0;
  v_unvalued               text[] := array[]::text[];"""),
("""  if p_usd_rate is not null and p_usd_rate > 0 then
    v_usd_rate := round(p_usd_rate::numeric, 2);
  else
    if v_base.id is not null and v_base.usd_rate is not null and v_base.usd_rate > 0 then
      v_usd_rate := v_base.usd_rate;
    else
      v_usd_rate := 12800.0;
    end if;
  end if;""",
"""  -- 084: no guessed USD rate (was 12 800). The passed rate, else the baseline's USD rate only when that baseline
  -- really valued dollars (older baselines stored a 1.0 placeholder when the tills held no USD), else none: USD is
  -- then reported as NOT valued and no period result is computed.
  if p_usd_rate is not null and p_usd_rate > 0 then
    v_usd_rate := round(p_usd_rate::numeric, 2);
  elsif v_base.id is not null and v_base.usd_rate is not null and v_base.usd_rate > 1
        and (coalesce((v_base.components_snapshot ->> 'cash_usd_total')::numeric, 0) > 0
             or coalesce((v_base.components_snapshot ->> 'usd_receivable_total')::numeric, 0) <> 0) then
    v_usd_rate := v_base.usd_rate;
  else
    v_usd_rate := null;
  end if;"""),
("""    into v_cust_debts_g, v_cust_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;""",
"""    into v_cust_debts_g, v_cust_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  -- 084: customers' UZS / USD balances (077 currency sales) are assets (debt) / liabilities (advance) too
  select coalesce(sum(greatest(debt_amount - advance_amount, 0)) filter (where currency = 'UZS'), 0),
         coalesce(sum(greatest(advance_amount - debt_amount, 0)) filter (where currency = 'UZS'), 0),
         coalesce(sum(greatest(debt_amount - advance_amount, 0)) filter (where currency = 'USD'), 0),
         coalesce(sum(greatest(advance_amount - debt_amount, 0)) filter (where currency = 'USD'), 0)
    into v_cur_uzs_debt, v_cur_uzs_adv, v_cur_usd_debt, v_cur_usd_adv
    from public.client_currency_accounts
   where organization_id = v_org_id;"""),
("""  if v_gold_rate_585 is not null and v_gold_rate_585 > 0 then
    v_cash_585_eq_g := round((v_total_cash_uzs / v_gold_rate_585)::numeric, 4);
    if v_usd_rate is not null and v_usd_rate > 0 then
      v_usd_585_eq_g := round(((v_total_usd * v_usd_rate) / v_gold_rate_585)::numeric, 4);
    end if;
  end if;""",
"""  if v_gold_rate_585 is not null and v_gold_rate_585 > 0 then
    v_cash_585_eq_g := round((v_total_cash_uzs / v_gold_rate_585)::numeric, 4);
    v_cur_uzs_debt_g := round((v_cur_uzs_debt / v_gold_rate_585)::numeric, 4);
    v_cur_uzs_adv_g  := round((v_cur_uzs_adv / v_gold_rate_585)::numeric, 4);
    if v_usd_rate is not null and v_usd_rate > 0 then
      v_usd_585_eq_g := round(((v_total_usd * v_usd_rate) / v_gold_rate_585)::numeric, 4);
      v_cur_usd_debt_g := round(((v_cur_usd_debt * v_usd_rate) / v_gold_rate_585)::numeric, 4);
      v_cur_usd_adv_g  := round(((v_cur_usd_adv * v_usd_rate) / v_gold_rate_585)::numeric, 4);
    end if;
  end if;
  -- 084: an amount that cannot be valued is listed, never valued at a guessed rate
  if (v_total_cash_uzs <> 0 or v_cur_uzs_debt <> 0 or v_cur_uzs_adv <> 0) and not coalesce(v_gold_rate_585 > 0, false) then
    v_unvalued := v_unvalued || format('UZS baholanmadi (585 kursi yo''q): kassa %s, mijoz qarzi %s, mijoz avansi %s', v_total_cash_uzs, v_cur_uzs_debt, v_cur_uzs_adv);
  end if;
  if (v_total_usd <> 0 or v_cur_usd_debt <> 0 or v_cur_usd_adv <> 0) and not (coalesce(v_usd_rate > 0, false) and coalesce(v_gold_rate_585 > 0, false)) then
    v_unvalued := v_unvalued || format('USD baholanmadi (USD kursi berilmagan): kassa %s, mijoz qarzi %s, mijoz avansi %s', v_total_usd, v_cur_usd_debt, v_cur_usd_adv);
  end if;"""),
("""    v_cash_585_eq_g + v_usd_585_eq_g +
    v_factory_advance_g,
    4
  );

  v_tot_liabilities_g := round(v_factory_debt_g + v_cust_advances_g, 4);""",
"""    v_cash_585_eq_g + v_usd_585_eq_g +
    v_cur_uzs_debt_g + v_cur_usd_debt_g +
    v_factory_advance_g,
    4
  );

  v_tot_liabilities_g := round(v_factory_debt_g + v_cust_advances_g + v_cur_uzs_adv_g + v_cur_usd_adv_g, 4);"""),
("""    'factory_advance_585_g', v_factory_advance_g
  );

  if v_base.id is not null then""",
"""    'factory_advance_585_g', v_factory_advance_g,
    'customer_uzs_debt_amount', v_cur_uzs_debt,
    'customer_uzs_advance_amount', v_cur_uzs_adv,
    'customer_usd_debt_amount', v_cur_usd_debt,
    'customer_usd_advance_amount', v_cur_usd_adv,
    'customer_uzs_debt_585_eq_g', v_cur_uzs_debt_g,
    'customer_uzs_advance_585_eq_g', v_cur_uzs_adv_g,
    'customer_usd_debt_585_eq_g', v_cur_usd_debt_g,
    'customer_usd_advance_585_eq_g', v_cur_usd_adv_g
  );

  if v_base.id is not null then"""),
("""  return jsonb_build_object(
    'status', case when v_base.id is null then 'baseline_not_set' else 'ok' end,
    'is_computable', (v_base.id is not null),
    'is_complete', (v_gold_rate_585 is not null and v_gold_rate_585 > 0 and v_rate_confirmed and v_base.id is not null),""",
"""  -- 084: a baseline confirmed WITHOUT customer currency balances cannot be compared once currency sales existed
  -- before it (the receivables would show up as profit): no result until the baseline is confirmed again
  if v_base.id is not null and not coalesce((v_base.components_snapshot ->> 'currency_receivables_included')::boolean, false)
     and exists (select 1 from public.jewelry_sales s where s.organization_id = v_org_id and s.sale_currency in ('UZS', 'USD')
                  and s.created_at <= v_base.created_at) then
    v_unvalued := v_unvalued || 'Boshlang''ich hisob mijozlarning UZS / USD qarzlarisiz tasdiqlangan, valyutali savdo esa undan oldin bor: natija taqqoslanmaydi - boshlang''ich hisobni qayta tasdiqlang'::text;
  end if;
  if coalesce(array_length(v_unvalued, 1), 0) > 0 then
    v_period_accounting_res := null;
  end if;

  return jsonb_build_object(
    'status', case when v_base.id is null then 'baseline_not_set' when coalesce(array_length(v_unvalued, 1), 0) > 0 then 'not_valued' else 'ok' end,
    'is_computable', (v_base.id is not null and coalesce(array_length(v_unvalued, 1), 0) = 0),
    'is_complete', (v_gold_rate_585 is not null and v_gold_rate_585 > 0 and v_rate_confirmed and v_base.id is not null and coalesce(array_length(v_unvalued, 1), 0) = 0),
    'not_valued', to_jsonb(v_unvalued),"""),
("""      else '[]'::jsonb
    end,""", """      else to_jsonb(v_unvalued)
    end,"""),
("""      'cash_usd_585_eq_g', v_usd_585_eq_g,
      'factory_advance_585_g', v_factory_advance_g
    ),
    'liabilities', jsonb_build_object(
      'factory_debt_585_g', v_factory_debt_g,
      'customer_advances_585_g', v_cust_advances_g
    )""",
"""      'cash_usd_585_eq_g', v_usd_585_eq_g,
      'customer_uzs_debt_585_eq_g', v_cur_uzs_debt_g,
      'customer_usd_debt_585_eq_g', v_cur_usd_debt_g,
      'factory_advance_585_g', v_factory_advance_g
    ),
    'liabilities', jsonb_build_object(
      'factory_debt_585_g', v_factory_debt_g,
      'customer_advances_585_g', v_cust_advances_g,
      'customer_uzs_advance_585_eq_g', v_cur_uzs_adv_g,
      'customer_usd_advance_585_eq_g', v_cur_usd_adv_g
    )"""),
]
# ------------------------------------------------------------------ baseline: currency balances included, no 1.0 USD placeholder
P["rpc_confirm_accounting_baseline"] = [
("""  v_net_assets_g           numeric(14, 4);""", """  v_net_assets_g           numeric(14, 4);
  v_cur_uzs_debt           numeric(18, 2) := 0;
  v_cur_uzs_adv            numeric(18, 2) := 0;
  v_cur_usd_debt           numeric(18, 2) := 0;
  v_cur_usd_adv            numeric(18, 2) := 0;
  v_cur_uzs_debt_g         numeric(14, 4) := 0;
  v_cur_uzs_adv_g          numeric(14, 4) := 0;
  v_cur_usd_debt_g         numeric(14, 4) := 0;
  v_cur_usd_adv_g          numeric(14, 4) := 0;"""),
("""  if v_cash_usd_total > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_rate_usd := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Kassalarda dollar (USD) mavjud, boshlang''ich hisob uchun tasdiqlangan USD kursi kiritilishi shart'
        using errcode = '22023';
    end if;
  else
    v_rate_usd := coalesce(p_usd_rate, 1.0);
  end if;""",
"""  -- 084: customers' UZS / USD balances are part of the baseline; USD needs a rate when the tills OR the customers
  -- hold dollars; otherwise no USD rate is stored (was a 1.0 placeholder that later valued dollars at 1 so'm)
  select coalesce(sum(greatest(debt_amount - advance_amount, 0)) filter (where currency = 'UZS'), 0),
         coalesce(sum(greatest(advance_amount - debt_amount, 0)) filter (where currency = 'UZS'), 0),
         coalesce(sum(greatest(debt_amount - advance_amount, 0)) filter (where currency = 'USD'), 0),
         coalesce(sum(greatest(advance_amount - debt_amount, 0)) filter (where currency = 'USD'), 0)
    into v_cur_uzs_debt, v_cur_uzs_adv, v_cur_usd_debt, v_cur_usd_adv
    from public.client_currency_accounts
   where organization_id = v_org_id;
  if v_cash_usd_total > 0 or v_cur_usd_debt > 0 or v_cur_usd_adv > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_rate_usd := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Kassalarda yoki mijoz qarzlarida dollar (USD) mavjud, boshlang''ich hisob uchun USD kursini kiriting'
        using errcode = '22023';
    end if;
  else
    v_rate_usd := case when p_usd_rate is not null and p_usd_rate > 0 then round(p_usd_rate::numeric, 2) end;
  end if;"""),
("""  if v_cash_usd_total > 0 and v_rate_usd > 0 then
    v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);
  else
    v_cash_usd_585_eq_g := 0;
  end if;""",
"""  if v_cash_usd_total > 0 and v_rate_usd > 0 then
    v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);
  else
    v_cash_usd_585_eq_g := 0;
  end if;
  v_cur_uzs_debt_g := round((v_cur_uzs_debt / v_rate_585)::numeric, 4);
  v_cur_uzs_adv_g  := round((v_cur_uzs_adv / v_rate_585)::numeric, 4);
  if v_rate_usd is not null and v_rate_usd > 0 then
    v_cur_usd_debt_g := round(((v_cur_usd_debt * v_rate_usd) / v_rate_585)::numeric, 4);
    v_cur_usd_adv_g  := round(((v_cur_usd_adv * v_rate_usd) / v_rate_585)::numeric, 4);
  end if;"""),
("""    v_cash_uzs_585_eq_g + v_cash_usd_585_eq_g +
    v_factory_advance_g,
    4
  );

  v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g, 4);""",
"""    v_cash_uzs_585_eq_g + v_cash_usd_585_eq_g +
    v_cur_uzs_debt_g + v_cur_usd_debt_g +
    v_factory_advance_g,
    4
  );

  v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g + v_cur_uzs_adv_g + v_cur_usd_adv_g, 4);"""),
("""    'net_assets_585_g', v_net_assets_g
  );""", """    'net_assets_585_g', v_net_assets_g,
    'currency_receivables_included', true,
    'uzs_receivable_total', v_cur_uzs_debt - v_cur_uzs_adv,
    'usd_receivable_total', v_cur_usd_debt - v_cur_usd_adv,
    'customer_uzs_debt_585_eq_g', v_cur_uzs_debt_g,
    'customer_uzs_advance_585_eq_g', v_cur_uzs_adv_g,
    'customer_usd_debt_585_eq_g', v_cur_usd_debt_g,
    'customer_usd_advance_585_eq_g', v_cur_usd_adv_g
  );"""),
]

NEW = r"""
-- ------------------------------------------------------------------ 1. one rate rule for every operation
-- The rate of an operation is the value entered with it; without one, the given default (a seller's saved rate or the
-- official rate). No hidden constant, no compulsory official rate. Inside the organization's limits (seller_rate_limits:
-- absolute min / max; a SELLER's LOM rate also within max_lom_deviation_pct of the official rate when one exists).
create or replace function public._goldia_operation_rate(p_org uuid, p_kind text, p_role text, p_sent numeric, p_default numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_lim  public.seller_rate_limits%rowtype;
  v      numeric;
  v_off  numeric;
  v_lab  text := case when p_kind = 'usd' then 'USD kursi (UZS)' else 'LOM / 585 kursi (UZS/g)' end;
begin
  v := case when p_sent is not null and p_sent > 0 then round(p_sent::numeric, 2)
            when p_default is not null and p_default > 0 then round(p_default::numeric, 2) end;
  if v is null then
    raise exception 'ERR_RATE_REQUIRED: % kiritilishi kerak (saqlangan kurs yo''q)', v_lab using errcode = '22023';
  end if;
  v_lim := public._goldia_seller_rate_limits(p_org);
  if p_kind = 'usd' then
    v := public._goldia_validate_rate_value(v, v_lim.usd_min_uzs, v_lim.usd_max_uzs, v_lab);
  else
    v := public._goldia_validate_rate_value(v, v_lim.lom_min_uzs, v_lim.lom_max_uzs, v_lab);
    if public._goldia_is_seller_role(p_role) and v_lim.max_lom_deviation_pct is not null then
      v_off := public._goldia_official_585_rate(p_org);
      if v_off is not null and v_off > 0 and abs(v - v_off) > v_off * v_lim.max_lom_deviation_pct / 100.0 then
        raise exception 'ERR_RATE_OUT_OF_RANGE: LOM kursi rasmiy 585 kursidan (% UZS/g) % foizdan ortiq farq qila olmaydi',
          v_off, v_lim.max_lom_deviation_pct using errcode = '22023';
      end if;
    end if;
  end if;
  return v;
end;
$function$;
revoke all on function public._goldia_operation_rate(uuid, text, text, numeric, numeric) from public, anon, authenticated;

-- a baseline without dollars stores no USD rate (the 1.0 placeholder valued later dollars at 1 so'm)
alter table public.accounting_baselines alter column usd_rate drop not null;

-- ------------------------------------------------------------------ 2. rate snapshot + manager review (2026-11-10)
-- Business decision confirmed 2026-11-10: seller, manager and director may enter / override the rate of an operation;
-- every operation keeps its actual rate, actor and time; history is never revalued; the manager reviews sellers' rates.
-- A handover stores the rate entered for its unvalued money (gold_rate_applied is the effective rate of the whole
-- handover). NULL on older rows and when nothing needed a rate. Written only by rpc_record_seller_to_manager_settlement.
alter table public.gold_settlements add column if not exists handover_entered_lom_rate numeric(18, 2);
comment on column public.gold_settlements.handover_entered_lom_rate is
  '084: LOM rate entered (or defaulted) for the unvalued cash / USD of a seller -> manager handover; snapshot, never revalued';

-- Read-only review of the rates used per operation. Management: every seller of the organization; a seller: only his
-- own operations. For each document: rate used, the seller's saved rate and the official 585 rate in force at that
-- moment, whether the rate differs from the saved default, deviation from the official rate, actor, time, status.
create or replace function public.rpc_get_operation_rate_review(p_start_date date default null, p_end_date date default null,
  p_seller_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org    uuid := public.current_organization_id();
  v_role   text := public.current_employee_role_text();
  v_emp    uuid := public.current_employee_id();
  v_end    date := coalesce(p_end_date, public._goldia_business_date());
  v_start  date := coalesce(p_start_date, coalesce(p_end_date, public._goldia_business_date()) - 30);
  v_seller uuid := p_seller_id;
  v_rows   jsonb;
  v_sum    jsonb;
  v_n      integer;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi']);
  if not public._goldia_is_management_role(v_role) then
    if p_seller_id is not null and p_seller_id is distinct from v_emp then
      raise exception 'Permission denied: sotuvchi faqat o''z operatsiyalari kurslarini ko''radi' using errcode = '42501';
    end if;
    v_seller := v_emp;
  end if;
  if v_end < v_start or v_end - v_start > 366 then
    raise exception 'Davr noto''g''ri (eng ko''pi 366 kun)' using errcode = '22023';
  end if;

  with docs as (
    select 'payment_gram'::text as kind, g.id, g.settlement_no as doc_no, g.settlement_date as doc_date, g.created_at,
           g.seller_id, g.customer_id, g.recorded_by, g.status, g.reversed_at, g.reversed_by,
           case when coalesce(g.cash_paid_amount, 0) > 0 then g.gold_rate_applied end as lom_rate,
           case when coalesce(g.usd_paid_amount, 0) > 0 then g.applied_usd_rate end as usd_rate,
           null::numeric as effective_rate, g.cash_paid_amount as cash_uzs, g.usd_paid_amount as usd, g.total_settled_grams as grams,
           null::text as debt_currency
      from public.gold_settlements g
     where g.organization_id = v_org and g.direction = 'client_to_seller' and g.reversal_of_id is null
       and g.settlement_date between v_start and v_end and (v_seller is null or g.seller_id = v_seller)
    union all
    select 'handover', g.id, g.settlement_no, g.settlement_date, g.created_at, g.seller_id, null, g.recorded_by, g.status,
           g.reversed_at, g.reversed_by, g.handover_entered_lom_rate,
           case when coalesce(g.usd_paid_amount, 0) > coalesce(g.till_pool_usd, 0) then g.applied_usd_rate end,
           case when coalesce(g.cash_paid_amount, 0) > 0 then g.gold_rate_applied end, g.cash_paid_amount, g.usd_paid_amount,
           g.total_settled_grams, null
      from public.gold_settlements g
     where g.organization_id = v_org and g.direction = 'seller_to_manager' and g.reversal_of_id is null
       and g.settlement_date between v_start and v_end and (v_seller is null or g.seller_id = v_seller)
    union all
    select 'payment_' || lower(c.debt_currency), c.id, c.settlement_no, c.settlement_date, c.created_at, c.seller_id, c.customer_id,
           c.recorded_by, c.status, c.reversed_at, c.reversed_by, c.rate_lom_uzs, c.rate_usd_uzs, null, c.cash_uzs, c.usd_amount,
           c.scrap_585_g, c.debt_currency
      from public.client_currency_settlements c
     where c.organization_id = v_org and c.settlement_date between v_start and v_end and (v_seller is null or c.seller_id = v_seller)
  ), enriched as (
    select d.*,
           (select h.new_lom_rate_uzs from public.seller_rate_history h
             where h.organization_id = v_org and h.seller_id = d.seller_id and h.changed_at <= d.created_at
             order by h.changed_at desc limit 1) as saved_lom,
           (select h.new_usd_rate_uzs from public.seller_rate_history h
             where h.organization_id = v_org and h.seller_id = d.seller_id and h.changed_at <= d.created_at
             order by h.changed_at desc limit 1) as saved_usd,
           (select r.rate_per_gram from public.daily_gold_rates r
             where r.organization_id = v_org and r.proba = 585 and r.rate_per_gram > 0 and r.created_at <= d.created_at
             order by r.is_confirmed desc, r.rate_date desc, r.created_at desc limit 1) as official_lom
      from docs d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', e.kind, 'id', e.id, 'doc_no', e.doc_no, 'doc_date', e.doc_date, 'created_at', e.created_at,
           'seller_id', e.seller_id, 'seller_name', coalesce(se.name, se.full_name),
           'customer_name', cu.contact_name, 'recorded_by', e.recorded_by, 'recorded_by_name', coalesce(rb.name, rb.full_name),
           'recorded_by_role', rb.role, 'status', e.status, 'reversed_at', e.reversed_at,
           'debt_currency', e.debt_currency, 'cash_uzs', e.cash_uzs, 'usd', e.usd, 'grams', e.grams,
           'lom_rate', e.lom_rate, 'usd_rate', e.usd_rate, 'effective_rate', e.effective_rate,
           'saved_lom_rate', e.saved_lom, 'saved_usd_rate', e.saved_usd, 'official_lom_rate', e.official_lom,
           'lom_differs_from_saved', e.lom_rate is not null and e.saved_lom is not null and e.lom_rate <> e.saved_lom,
           'usd_differs_from_saved', e.usd_rate is not null and e.saved_usd is not null and e.usd_rate <> e.saved_usd,
           'lom_deviation_from_official_pct', case when e.lom_rate is not null and e.official_lom > 0
             then round((e.lom_rate - e.official_lom) / e.official_lom * 100, 2) end)
         order by e.created_at desc), '[]'::jsonb), count(*)
    into v_rows, v_n
    from (select * from enriched order by created_at desc limit 2000) e
    left join public.employees se on se.id = e.seller_id
    left join public.employees rb on rb.id = e.recorded_by
    left join public.customers cu on cu.id = e.customer_id;

  select coalesce(jsonb_agg(x order by x ->> 'seller_name'), '[]'::jsonb) into v_sum from (
    select jsonb_build_object('seller_id', r ->> 'seller_id', 'seller_name', max(r ->> 'seller_name'), 'operations', count(*),
             'lom_differs_from_saved', count(*) filter (where (r ->> 'lom_differs_from_saved')::boolean),
             'usd_differs_from_saved', count(*) filter (where (r ->> 'usd_differs_from_saved')::boolean),
             'max_abs_lom_deviation_pct', max(abs((r ->> 'lom_deviation_from_official_pct')::numeric))) as x
      from jsonb_array_elements(v_rows) r group by r ->> 'seller_id') s;

  return jsonb_build_object('status', 'ok', 'start_date', v_start, 'end_date', v_end,
    'seller_id', v_seller, 'truncated', v_n >= 2000, 'rows', v_rows, 'by_seller', v_sum);
end;
$function$;
revoke all on function public.rpc_get_operation_rate_review(date, date, uuid) from public, anon;
grant execute on function public.rpc_get_operation_rate_review(date, date, uuid) to authenticated;
"""

head = """-- 084 — Goldia Sales: per-operation LOM / USD rates (no compulsory or guessed rate) + customer UZS / USD balances in
-- the profit summary and the baseline (2026-11-09). Generated by docs/releases/production-075/gen-084-rates.py.
-- Root causes fixed:
--   * payments / handovers forced a seller's saved rate or the official daily rate (ERR_RATE_MISMATCH /
--     ERR_DAILY_RATE_NOT_SET): now every role enters the rate per operation, the saved / official rate is only the
--     default, the organization limits stay; the rate is snapshotted on the document (old documents never re-priced);
--   * guessed constants: profit summary USD 12 800, financial transactions 880 000 / 12 800, seller -> factory cash
--     900 000, historical import 900 000 - removed (refused / not valued / row skipped instead);
--   * baseline stored usd_rate 1.0 when the tills held no USD -> later dollars were valued at 1 so'm; now NULL;
--   * customers' UZS / USD balances were missing from the profit summary and the baseline -> now assets (debt) and
--     liabilities (advance), valued at the report's rates; an amount without a rate is listed as not valued and no
--     period result is shown; a baseline confirmed without them (with older currency sales) must be confirmed again.
-- No document, balance or history row is changed.
"""
changed, rb = [], []
for fn, pairs in P.items():
    body, src = latest(fn)
    changed.append(f"\n-- ===== {fn} (from {src})\n" + patch(body, pairs, fn) + ";\n")
    rb.append(f"\n-- ===== {fn} (restore the body of {src})\n" + body + ";\n")
(REPO / "supabase/migrations/20260101000084_goldia_operation_rates_and_currency_valuation.sql").write_text(head + NEW + "".join(changed), encoding="utf-8")
(REPO / "supabase/rollback/20260101000084_rollback.sql").write_text(
    "-- Rollback of 084: restores the previous bodies; usd_rate becomes NOT NULL again only if no baseline stored NULL.\n"
    "-- Refused while a handover holds an entered-rate snapshot (dropping the column would lose that audit fact).\n"
    + "do $g$ begin if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gold_settlements'\n"
      "  and column_name = 'handover_entered_lom_rate') then\n"
      "  if exists (select 1 from public.gold_settlements where handover_entered_lom_rate is not null) then\n"
      "    raise exception 'ROLLBACK 084 REFUSED: handovers hold entered-rate snapshots (handover_entered_lom_rate)';\n"
      "  end if; end if; end $g$;\n"
    + "".join(rb)
    + "\ndo $nn$ begin if not exists (select 1 from public.accounting_baselines where usd_rate is null) then\n"
      "  alter table public.accounting_baselines alter column usd_rate set not null; end if; end $nn$;\n"
    + "drop function if exists public.rpc_get_operation_rate_review(date, date, uuid);\n"
    + "alter table public.gold_settlements drop column if exists handover_entered_lom_rate;\n"
    + "drop function if exists public._goldia_operation_rate(uuid, text, text, numeric, numeric);\n", encoding="utf-8")
print("ok", len(P), "functions")
