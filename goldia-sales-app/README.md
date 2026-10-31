# Goldia Sales — standalone application

Goldia Sales (sales, consignment, gold-denominated debts, cash/scrap, refining handovers),
separated from the JewelryFlow Manufacturing ERP at the application level. It contains no
manufacturing pages, modules or hooks; the routes, reports, roles and API endpoints are the
same as on `goldia-sales-production.vercel.app`.

**The database is NOT separated.** This app uses the same Supabase project, auth users,
migrations, RPCs and RLS as production. Nothing here copies, splits or migrates data.

## Run / verify

```
npm install
npm run typecheck && npm run lint && npm run build
```

## Vercel (new project — the live project stays as it is)

- Root Directory: `goldia-sales-app`, framework Next.js, Node 22
- Environment variables (same values as the current production project):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  (server only, employee creation), `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_APP_ENV=production`
- Never set `NEXT_PUBLIC_DEMO_PASSWORD` in production.
- Switch the domain only after this project has been verified on its own preview URL.

## Database dependency map (generated from `src/`)

Database migrations stay in the main repository (`supabase/migrations`) until a separately
tested database migration plan exists.

**Tables shared with Manufacturing ERP (keep shared):** audit_logs, employees, orders, products,
sales — plus organizations, auth.users and the helper functions current_organization_id,
current_employee_id, current_employee_role_text, assert_erp_permission,
check_and_lock_idempotency, save_idempotency_response, which every RPC uses.

**Sales-only tables:** accounting_baselines, client_gold_accounts, client_legacy_debts, consignment_pieces, customers, daily_gold_rates, factory_gold_handovers, factory_receipts, financial_transactions, gold_purchases, gold_settlements, jewelry_models, jewelry_sales, manager_vault_account, refining_batches, sales_login_audit_logs, sales_markup_presets, seller_consignments, seller_gold_accounts, sheets_import_batches.

**RPCs called by this app (54), none called by Manufacturing pages:** current_employee_id, current_employee_role_text, get_manager_available_stock_grams, get_seller_available_stock_grams, rpc_confirm_accounting_baseline, rpc_create_customer_with_code, rpc_create_jewelry_model, rpc_execute_full_test_reset, rpc_execute_selective_test_cleanup, rpc_execute_sheets_historical_import, rpc_generate_telegram_link_code, rpc_get_accounting_profit_summary, rpc_get_active_sales_markups, rpc_get_company_rate_difference_report, rpc_get_customer_monthly_report, rpc_get_daily_sales_ledger, rpc_get_seller_reconciliation_statement, rpc_get_unified_customer_ledger, rpc_issue_barcode_consignment, rpc_issue_seller_consignment, rpc_manage_sales_markup_preset, rpc_preview_full_test_reset, rpc_preview_selective_test_cleanup, rpc_reclassify_capital_transaction, rpc_record_barcode_piece_sale, rpc_record_client_jewelry_sale, rpc_record_client_legacy_debt, rpc_record_client_settlement, rpc_record_debt_repayment, rpc_record_factory_gold_handover, rpc_record_factory_receipt, rpc_record_financial_transaction, rpc_record_gold_purchase, rpc_record_login_audit, rpc_record_refining_batch, rpc_record_sale_with_stock_deduction, rpc_record_seller_to_manager_settlement, rpc_record_weight_sale, rpc_register_or_get_customer, rpc_return_piece_to_manager, rpc_reverse_barcode_consignment, rpc_reverse_client_legacy_debt, rpc_reverse_client_sale, rpc_reverse_client_settlement, rpc_reverse_factory_gold_handover, rpc_reverse_factory_receipt, rpc_reverse_financial_transaction, rpc_reverse_gold_purchase, rpc_reverse_refining_batch, rpc_reverse_seller_to_manager_settlement, rpc_set_daily_gold_rate, rpc_unlink_telegram, rpc_update_jewelry_model_photo, rpc_verify_and_link_telegram.


**Storage:** model photos through `/api/models/photo` (same bucket as production).

## Not separated yet

- `src/lib/erp-engine.ts` is the shared engine file copied as a whole; it still contains
  manufacturing helpers that Sales never calls. Trim it once both apps have their own tests.
- `/sales` (classic page) reads the shared `orders`, `products`, `sales` tables.
- Database tests (`src/lib/__tests__`) and release scripts remain in the main repository.
