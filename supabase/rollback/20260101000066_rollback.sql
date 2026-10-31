-- ROLLBACK for migration 20260101000066_goldia_company_rate_difference_ledger.sql
-- NOT a migration (never applied automatically). Stops recording new rate differences and
-- removes the report RPC. Keeps company_rate_differences rows and the valued pool columns
-- (audit history is never deleted). Purchases, settlements and balances are unaffected:
-- 066 never changed them.

begin;

drop trigger if exists trg_goldia_rate_difference_from_purchase on public.gold_purchases;
drop trigger if exists trg_goldia_valued_cash_from_settlement on public.gold_settlements;
drop function if exists public.trg_goldia_rate_difference_from_purchase();
drop function if exists public.trg_goldia_valued_cash_from_settlement();
drop function if exists public.rpc_get_company_rate_difference_report(date, date);

commit;
