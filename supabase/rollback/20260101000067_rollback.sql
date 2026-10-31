-- ROLLBACK for migration 20260101000067_goldia_seller_markup_difference.sql
-- NOT a migration (never applied automatically). Stops new markup-difference snapshots and removes
-- the report. Keeps the three jewelry_sales snapshot columns and their values (history is never
-- deleted). Balances are unaffected: 067 never changed them. The corrected idempotency argument in
-- rpc_record_barcode_piece_sale is kept on purpose (restoring it would break retries again).

begin;

drop trigger if exists trg_goldia_sale_markup_snapshot on public.jewelry_sales;
drop trigger if exists trg_goldia_piece_markup_snapshot on public.consignment_pieces;
drop function if exists public.trg_goldia_sale_markup_snapshot();
drop function if exists public.trg_goldia_piece_markup_snapshot();
drop function if exists public.rpc_get_seller_markup_difference_report(uuid, date, date);

commit;
