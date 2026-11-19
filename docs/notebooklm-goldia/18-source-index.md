# 18. Manbalar indeksi (source index)

> **Tekshiruv pasporti:** commit `052ad17` (branch `claude/goldia-sales-staging-audit-qtrq1d`), schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

## 1. Biznes savoli → javob qayerda

| Savol | Hujjat | Asosiy kod manbasi |
|---|---|---|
| Ilova nima, zanjir qanday? | 01 §1–2 | `src/app/sales/app/page.tsx` |
| Kim nima qila oladi? | 02 | `src/lib/sales-role-access.ts`, `assert_erp_permission` |
| Savdo qanday yoziladi, formula? | 03, 11 §D | `rpc_record_weight_sale`, `rpc_record_barcode_piece_sale`, `rpc_record_currency_sale` |
| Mijoz qarzi/avansi qanday hisoblanadi? | 04 §1–2, 11 §I | `src/lib/customer-balance.ts` |
| Eski qarz qanday kiritiladi? | 04 §6 | `rpc_record_client_legacy_debt` |
| Mijozni o'chirish/arxiv | 04 §5 | `rpc_archive_customer`, 078/079 triggerlar |
| SETTL va CPAY farqi, valyuta konvertatsiyasi | 05 §2–4, 11 §E | `rpc_record_client_settlement`, `rpc_record_client_currency_settlement` |
| 585 proba, fizik vazn, sof oltin | 05 §1, 11 §A | o'sha |
| LOM kursi, sotuvchi kurslari, chegaralar | 05 §6 | `_goldia_operation_rate`, `_goldia_seller_rate_limits`, `rpc_set_my_seller_rates` |
| Sotuvchi kassasini topshirish, havza, kurs farqi | 05 §5, 11 §F | `rpc_record_seller_to_manager_settlement` |
| Sotuvchi majburiyati / Bozor qarzi | 09 §3, 11 §C | `recalc_seller_gold_account` |
| Sotuvchiga tovar tarqatish | 06 §3 | `rpc_issue_barcode_consignment` |
| Ombor qoldiqlari | 06 §2, §5 | `get_manager_available_stock_grams`, `get_seller_available_stock_grams` |
| Zavod qarzi, topshirish, C2 | 07 §2–4 | `rpc_record_factory_receipt`, `rpc_record_factory_gold_handover`, `_goldia_vault_factory_add` |
| Xarid, afinaj, kapital, xarajat | 07 §5–7 | `rpc_record_gold_purchase`, `rpc_record_refining_batch`, `rpc_record_financial_transaction` |
| Boshlang'ich hisob, restart, freeze | 07 §9 | `rpc_financial_restart`, `rpc_record_opening_document`, `_goldia_guard_opening_draft` |
| Bekor qilishda nima o'zgaradi? | 08 | `rpc_reverse_*`, `rpc_record_sale_return` |
| Foyda qanday? | 09 §5, 11 §I | `rpc_get_accounting_profit_summary` |
| Davriy hisobot | 09 §4 | `rpc_get_period_report`, `_goldia_period_effects` |
| Ustama farqi | 09 §6 | `trg_goldia_sale_markup_snapshot`, migration 067 |
| Qaysi tugma qayerda? | 10 | sahifa fayllari (§3) |
| Xato kodlari | 12, §4 quyida | `errors` jadvali |
| Production'da nima bor? | 14 | `docs/audits/goldia-077/RELEASE-089-REPORT.md`, `RELEASE-090-REPORT.md`, `RELEASE-091-REPORT.md` |
| Qarama-qarshiliklar | CONFLICTS.md | — |
| Testlar | 17 | `src/lib/__tests__/*` |

## 2. Sahifa → komponent → asosiy RPC

| Sahifa (URL) | Fayl | Komponent(lar) | Asosiy RPC |
|---|---|---|---|
| `/sales/app` | `src/app/sales/app/page.tsx` | `ManagerSimplePanel`, `ProfitAccountingBanner`, `SellerDashboard` | `rpc_get_accounting_profit_summary`, `rpc_record_financial_transaction`, `rpc_confirm_accounting_baseline`, `rpc_reclassify_capital_transaction` |
| `/sales/app/factory` | `factory/page.tsx` | `DirectorSalesWorkspace(factory)`, `FactoryGoodsReturnSection` | `rpc_record_factory_receipt`, `rpc_record_factory_gold_handover`, `rpc_return_goods_to_factory` |
| `/sales/app/factory-receive` | `factory-receive/page.tsx` | `DirectorSalesWorkspace(factory/receive)` | `rpc_record_factory_receipt` |
| `/sales/app/handovers` | `handovers/page.tsx` | `DirectorSalesWorkspace(factory/handover)` | `rpc_record_factory_gold_handover` |
| `/sales/app/inventory` | `inventory/page.tsx` | `SellerInventoryDashboard` | `rpc_return_piece_to_manager` |
| `/sales/app/consignments` | `consignments/page.tsx` | `ScannerConsignmentSection` | `rpc_issue_barcode_consignment` |
| `/sales/app/sellers` | `sellers/page.tsx` | `DirectorSalesWorkspace(sellers)`, `SellerRatesOverview`, `OperationRateReview`, `SellerReconciliationModal`, `SellerTillCountModal` | `rpc_record_seller_to_manager_settlement`, `rpc_get_seller_rates`, `rpc_get_operation_rate_review`, `rpc_get_seller_reconciliation_statement`, `rpc_record_seller_till_count` |
| `/sales/app/stock-movements` | `stock-movements/page.tsx` | — | `rpc_get_seller_stock_movements` |
| `/sales/app/scan` | `scan/page.tsx` | `SellerMobileWorkspace(scan_sale, pieces, stock)` | `rpc_record_barcode_piece_sale`, `rpc_return_piece_to_manager` |
| `/sales/app/customers` | `customers/page.tsx` | `CustomerLedgerAndSheetsSection`, `SellerMobileWorkspace`, `CurrencyPaymentModal`, `SaleReturnModal`, `SaleEditModal`, `PaymentCorrectionModal`, `OpeningSaleReturnModal` | savdo, SETTL, CPAY, vozvrat, reversal, eski qarz, arxiv RPC'lari |
| `/sales/app/cash` | `cash/page.tsx` | `DirectorSalesWorkspace(vault/cash)`, `SellerLomPurchaseSection` | `rpc_record_seller_lom_purchase` |
| `/sales/app/kassam` | `kassam/page.tsx` | `SellerRatesCard`, `SellerMobileWorkspace(till)`, `SellerLomPurchaseSection` | `rpc_set_my_seller_rates` |
| `/sales/app/markup` | `markup/page.tsx` | `MarkupDifferenceCard` | `rpc_get_seller_markup_difference_report` |
| `/sales/app/refining` | `refining/page.tsx` | `DirectorSalesWorkspace(vault/refining)` | `rpc_record_refining_batch` |
| `/sales/app/purchases` | `purchases/page.tsx` | `DirectorSalesWorkspace(vault/purchases)` | `rpc_record_gold_purchase` |
| `/sales/app/period-report` | `period-report/page.tsx` | — | `rpc_get_period_report`, `rpc_close_report_period`, `rpc_reopen_report_period` |
| `/sales/app/opening` | `opening/page.tsx` | `OpeningAccountingSection` | `rpc_financial_restart`, `rpc_record_opening_document`, `rpc_cancel_opening_document`, `rpc_get_opening_state` |
| `/sales/app/reports` | `reports/page.tsx` | `DirectorSalesWorkspace(history)` | reversal RPC'lari |
| `/sales/app/models` | `models/page.tsx` | `BarTenderModelManager` | `rpc_create_jewelry_model`, `rpc_update_jewelry_model_photo` |
| `/sales/app/users` | `users/page.tsx` | `TelegramUsersSection` | Telegram RPC'lari |
| `/sales/app/settings` | `settings/page.tsx` | presetlar, `SheetsImportSection`, `TestCleanupSection` (staging) | `rpc_manage_sales_markup_preset`, `rpc_execute_sheets_historical_import` |
| `/sales/director` | `src/app/sales/director/page.tsx` | `DirectorSalesWorkspace` (to'liq; yuqori bannerda `ProfitAccountingBanner`, `CompanyRateDifferenceCard`, `MarkupDifferenceCard showBySeller`) | hammasi + `rpc_get_company_rate_difference_report` |

## 3. Asosiy loyiha hujjatlari (manba sifatida o'qilgan)

- `docs/audits/goldia-077/RELEASE-089-REPORT.md`, `RELEASE-090-REPORT.md`, `RELEASE-091-REPORT.md` — 089–091 mazmuni va production holati.
- `docs/audits/goldia-077/OPENING-085-REPORT.md` — boshlang'ich hisob qoidalari (A–L).
- `docs/audits/goldia-077/PRODUCTION-088-CORRECTION.md` — 088 qoidalari (**ichida real production raqamlari va ismlar bor — bu hujjatlarga ko'chirilmagan**).
- `docs/releases/RELEASE.md` — release jarayoni.
- Migration fayl boshidagi izohlar (065–091).

## 4. Barcha savdo RPC'lari (avtomatik indeks)

Holat ustuni: "production (≤088)" — birinchi va oxirgi ta'rif ≤088; "prod: oldingi versiya..." — production'da 088 gacha bo'lgan versiya, kodda 089+ yangilangan; "faqat kodda" — 089+ da yaratilgan. Ishlab chiqarish (manufacturing) RPC'lari kiritilmagan.

| RPC | Eng so'nggi migration | Fayl:qator | Holat | UI chaqiradi | Hujjat |
|---|---|---|---|---|---|
| `rpc_archive_customer` | 78 | `20260101000078_goldia_seller_customer_archive_and_period_reopen.sql:54` | production (≤088) | ha | 04 §5 |
| `rpc_cancel_opening_document` | 88 | `20260101000088_goldia_factory_settled_and_unrated_currency.sql:366` | production (≤088) | ha | 07 §9 |
| `rpc_close_report_period` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:2585` | production (≤088) | ha | 09 §4 |
| `rpc_confirm_accounting_baseline` | 85 | `20260101000085_goldia_financial_restart_and_opening_accounting.sql:2464` | production (≤088) | ha | 07 §9, 09 §5 |
| `rpc_correct_client_payment` | 89 | `20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql:1427` | faqat kodda (deploy qilinmagan) | ha | 05 §9 |
| `rpc_create_customer_with_code` | 75 | `20260101000075_goldia_customer_codes_per_org_and_factory_settings_isolation.sql:44` | production (≤088) | ha | 04 §4 |
| `rpc_create_jewelry_model` | 74 | `20260101000074_goldia_tenant_isolation_models_and_loss_configs.sql:90` | production (≤088) | ha | 06 §9 |
| `rpc_create_jewelry_sale` | 73 | `20260101000073_goldia_release_candidate_stabilization.sql:305` | production (≤088) | — | — |
| `rpc_diagnose_piece_inventory_conflicts` | 41 | `20260101000041_jules_security_hardening.sql:503` | production (≤088) | — | — |
| `rpc_edit_client_sale` | 90 | `20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql:1173` | faqat kodda (deploy qilinmagan) | ha | 08 §3 |
| `rpc_execute_full_test_reset` | 91 | `20260101000091_goldia_factory_handover_c2_fix_seller_lom_purchase.sql:574` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | — |
| `rpc_execute_selective_test_cleanup` | 52 | `20260101000052_goldia_reversal_parity_and_audit_fixes.sql:1059` | production (≤088) | ha | — |
| `rpc_execute_sheets_historical_import` | 84 | `20260101000084_goldia_operation_rates_and_currency_valuation.sql:1408` | production (≤088) | ha | 10 §19 |
| `rpc_execute_staging_test_cleanup` | 39 | `20260101000039_safe_corrections_reversals_and_staging_cleanup.sql:1057` | production (≤088) | — | — |
| `rpc_financial_restart` | 91 | `20260101000091_goldia_factory_handover_c2_fix_seller_lom_purchase.sql:393` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | 07 §9 |
| `rpc_generate_telegram_link_code` | 33 | `20260101000033_sales_app_roles_telegram_and_sheets_import.sql:69` | production (≤088) | ha | — |
| `rpc_get_accounting_profit_summary` | 85 | `20260101000085_goldia_financial_restart_and_opening_accounting.sql:2076` | production (≤088) | ha | 09 §5 |
| `rpc_get_active_sales_markups` | 27 | `20260101000027_dynamic_sales_markups_and_presets.sql:162` | production (≤088) | ha | 10 §19 |
| `rpc_get_company_rate_difference_report` | 73 | `20260101000073_goldia_release_candidate_stabilization.sql:527` | production (≤088) | ha | 09 §7 |
| `rpc_get_customer_monthly_report` | 83 | `20260101000083_goldia_partial_sale_returns.sql:702` | production (≤088) | ha | 04 §3 |
| `rpc_get_daily_sales_ledger` | 89 | `20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql:836` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | 04 §3 |
| `rpc_get_director_sales_overview` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:354` | production (≤088) | — | — |
| `rpc_get_financial_reconciliation_summary` | 70 | `20260101000070_goldia_acceptance_audit_fixes.sql:1723` | production (≤088) | — | — |
| `rpc_get_manager_available_stock_grams` | 71 | `20260101000071_goldia_seller_company_stock_guard.sql:11` | production (≤088) | ha | 06 §2 |
| `rpc_get_opening_state` | 88 | `20260101000088_goldia_factory_settled_and_unrated_currency.sql:478` | production (≤088) | ha | 07 §9 |
| `rpc_get_operation_rate_review` | 84 | `20260101000084_goldia_operation_rates_and_currency_valuation.sql:70` | production (≤088) | ha | 05 §6 |
| `rpc_get_period_report` | 80 | `20260101000080_goldia_period_report_performance.sql:181` | production (≤088) | ha | 09 §4 |
| `rpc_get_piece_sales_reconciliation_report` | 38 | `20260101000038_final_sales_mega_fix.sql:404` | production (≤088) | — | — |
| `rpc_get_seller_available_pieces` | 70 | `20260101000070_goldia_acceptance_audit_fixes.sql:1949` | production (≤088) | — | — |
| `rpc_get_seller_markup_difference_report` | 83 | `20260101000083_goldia_partial_sale_returns.sql:1324` | production (≤088) | ha | 09 §6 |
| `rpc_get_seller_rates` | 72 | `20260101000072_goldia_independent_seller_rates.sql:223` | production (≤088) | ha | 05 §6 |
| `rpc_get_seller_reconciliation_statement` | 83 | `20260101000083_goldia_partial_sale_returns.sql:1406` | production (≤088) | ha | 09 §3 |
| `rpc_get_seller_sales_summary` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:1155` | production (≤088) | — | — |
| `rpc_get_seller_stock_movements` | 90 | `20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql:765` | faqat kodda (deploy qilinmagan) | ha | 06 §8 |
| `rpc_get_three_tier_ledger_summary` | 83 | `20260101000083_goldia_partial_sale_returns.sql:1701` | production (≤088) | — | — |
| `rpc_get_unified_customer_ledger` | 89 | `20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql:601` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | 04 §8 |
| `rpc_issue_barcode_consignment` | 90 | `20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql:115` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | 06 §3 |
| `rpc_issue_seller_consignment` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:428` | production (≤088) | ha | 06 §4 |
| `rpc_manage_sales_markup_preset` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:559` | production (≤088) | ha | 10 §19 |
| `rpc_preview_full_test_reset` | 61 | `20260101000061_goldia_inventory_usd_settlement_and_gram_workflow_parity.sql:1218` | production (≤088) | ha | — |
| `rpc_preview_opening_sale_return` | 89 | `20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql:1198` | faqat kodda (deploy qilinmagan) | ha | 08 §7 |
| `rpc_preview_selective_test_cleanup` | 52 | `20260101000052_goldia_reversal_parity_and_audit_fixes.sql:958` | production (≤088) | ha | — |
| `rpc_preview_staging_test_cleanup` | 39 | `20260101000039_safe_corrections_reversals_and_staging_cleanup.sql:934` | production (≤088) | — | — |
| `rpc_reclassify_capital_transaction` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:635` | production (≤088) | ha | 07 §7 |
| `rpc_record_barcode_piece_sale` | 76 | `20260101000076_goldia_legacy_debt_manager_and_seller.sql:663` | production (≤088) | ha | 03 §2 |
| `rpc_record_client_currency_settlement` | 89 | `20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql:143` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | 05 §4 |
| `rpc_record_client_jewelry_sale` | 76 | `20260101000076_goldia_legacy_debt_manager_and_seller.sql:901` | production (≤088) | ha | 03 §4 |
| `rpc_record_client_legacy_debt` | 81 | `20260101000081_goldia_seller_legacy_advance.sql:18` | production (≤088) | ha | 04 §6 |
| `rpc_record_client_settlement` | 84 | `20260101000084_goldia_operation_rates_and_currency_valuation.sql:175` | production (≤088) | ha | 05 §3 |
| `rpc_record_currency_sale` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:1356` | production (≤088) | ha | 03 §3 |
| `rpc_record_factory_gold_handover` | 91 | `20260101000091_goldia_factory_handover_c2_fix_seller_lom_purchase.sql:58` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | 07 §3 |
| `rpc_record_factory_receipt` | 70 | `20260101000070_goldia_acceptance_audit_fixes.sql:1093` | production (≤088) | ha | 07 §2 |
| `rpc_record_financial_transaction` | 84 | `20260101000084_goldia_operation_rates_and_currency_valuation.sql:963` | production (≤088) | ha | 07 §7 |
| `rpc_record_gold_purchase` | 63 | `20260101000063_goldia_monthly_report_parity_and_strict_gold_purchase.sql:252` | production (≤088) | ha | 07 §5 |
| `rpc_record_login_audit` | 33 | `20260101000033_sales_app_roles_telegram_and_sheets_import.sql:206` | production (≤088) | ha | — |
| `rpc_record_manager_seller_settlement` | 73 | `20260101000073_goldia_release_candidate_stabilization.sql:1872` | production (≤088) | — | — |
| `rpc_record_opening_document` | 88 | `20260101000088_goldia_factory_settled_and_unrated_currency.sql:70` | production (≤088) | ha | 07 §9 |
| `rpc_record_opening_sale_return` | 89 | `20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql:1216` | faqat kodda (deploy qilinmagan) | ha | 08 §7 |
| `rpc_record_refining_batch` | 73 | `20260101000073_goldia_release_candidate_stabilization.sql:3020` | production (≤088) | ha | 07 §6 |
| `rpc_record_sale_return` | 83 | `20260101000083_goldia_partial_sale_returns.sql:84` | production (≤088) | ha | 08 §2 |
| `rpc_record_seller_lom_purchase` | 91 | `20260101000091_goldia_factory_handover_c2_fix_seller_lom_purchase.sql:1075` | faqat kodda (deploy qilinmagan) | ha | 05 §7 |
| `rpc_record_seller_till_count` | 89 | `20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql:1497` | faqat kodda (deploy qilinmagan) | ha | 05 §8 |
| `rpc_record_seller_to_factory_settlement` | 84 | `20260101000084_goldia_operation_rates_and_currency_valuation.sql:1254` | production (≤088) | — | — |
| `rpc_record_seller_to_manager_settlement` | 85 | `20260101000085_goldia_financial_restart_and_opening_accounting.sql:1498` | production (≤088) | ha | 05 §5 |
| `rpc_record_weight_sale` | 76 | `20260101000076_goldia_legacy_debt_manager_and_seller.sql:415` | production (≤088) | ha | 03 §1 |
| `rpc_register_or_get_customer` | 26 | `20260101000026_jewelry_sales_consignment_and_gold_ledger.sql:342` | production (≤088) | ha | 04 §4 |
| `rpc_reopen_report_period` | 78 | `20260101000078_goldia_seller_customer_archive_and_period_reopen.sql:156` | production (≤088) | ha | 09 §4 |
| `rpc_return_goods_to_factory` | 90 | `20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql:979` | faqat kodda (deploy qilinmagan) | ha | 07 §8 |
| `rpc_return_piece_to_factory` | 65 | `20260101000065_goldia_blocker_high_audit_fixes.sql:185` | production (≤088) | — | — |
| `rpc_return_piece_to_manager` | 90 | `20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql:359` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | 06 §6 |
| `rpc_reverse_barcode_consignment` | 90 | `20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql:912` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | 06 §7 |
| `rpc_reverse_barcode_piece_sale` | 45 | `20260101000045_goldia_core_sales_workflow_and_multi_currency.sql:548` | production (≤088) | — | — |
| `rpc_reverse_client_currency_settlement` | 88 | `20260101000088_goldia_factory_settled_and_unrated_currency.sql:1048` | production (≤088) | ha | 08 §4 |
| `rpc_reverse_client_legacy_debt` | 76 | `20260101000076_goldia_legacy_debt_manager_and_seller.sql:272` | production (≤088) | ha | 04 §6 |
| `rpc_reverse_client_sale` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:1772` | production (≤088) | ha | 08 §1 |
| `rpc_reverse_client_settlement` | 65 | `20260101000065_goldia_blocker_high_audit_fixes.sql:1720` | production (≤088) | ha | 08 §4 |
| `rpc_reverse_customer_settlement` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:855` | production (≤088) | — | — |
| `rpc_reverse_factory_gold_handover` | 91 | `20260101000091_goldia_factory_handover_c2_fix_seller_lom_purchase.sql:239` | prod: oldingi versiya; yangi versiya deploy qilinmagan | ha | 07 §3 |
| `rpc_reverse_factory_goods_return` | 90 | `20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql:1066` | faqat kodda (deploy qilinmagan) | ha | 07 §8 |
| `rpc_reverse_factory_receipt` | 58 | `20260101000058_goldia_factory_advance_and_capital_linking.sql:557` | production (≤088) | ha | 07 §2 |
| `rpc_reverse_financial_transaction` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:2630` | production (≤088) | ha | 07 §7 |
| `rpc_reverse_gold_purchase` | 64 | `20260101000064_goldia_audit_production_fixes.sql:1158` | production (≤088) | ha | 07 §5 |
| `rpc_reverse_jewelry_sale` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:2009` | production (≤088) | — | — |
| `rpc_reverse_opening_sale_return` | 89 | `20260101000089_goldia_opening_returns_cpay_history_till_counts_stock.sql:1362` | faqat kodda (deploy qilinmagan) | ha | 08 §7 |
| `rpc_reverse_refining_batch` | 64 | `20260101000064_goldia_audit_production_fixes.sql:1036` | production (≤088) | ha | 07 §6 |
| `rpc_reverse_seller_lom_purchase` | 91 | `20260101000091_goldia_factory_handover_c2_fix_seller_lom_purchase.sql:1195` | faqat kodda (deploy qilinmagan) | ha | 05 §7 |
| `rpc_reverse_seller_to_manager_settlement` | 73 | `20260101000073_goldia_release_candidate_stabilization.sql:2463` | production (≤088) | ha | 08 §4 |
| `rpc_set_daily_gold_rate` | 73 | `20260101000073_goldia_release_candidate_stabilization.sql:2660` | production (≤088) | ha | 05 §6 |
| `rpc_set_my_seller_rates` | 72 | `20260101000072_goldia_independent_seller_rates.sql:147` | production (≤088) | ha | 05 §6 |
| `rpc_set_seller_rate_limits` | 72 | `20260101000072_goldia_independent_seller_rates.sql:278` | production (≤088) | — | — |
| `rpc_transfer_to_seller` | 77 | `20260101000077_goldia_manager_parity_currency_sales_period_report.sql:995` | production (≤088) | — | — |
| `rpc_unlink_telegram` | 33 | `20260101000033_sales_app_roles_telegram_and_sheets_import.sql:181` | production (≤088) | ha | — |
| `rpc_update_jewelry_model_photo` | 74 | `20260101000074_goldia_tenant_isolation_models_and_loss_configs.sql:224` | production (≤088) | ha | 06 §9 |
| `rpc_verify_and_link_telegram` | 33 | `20260101000033_sales_app_roles_telegram_and_sheets_import.sql:113` | production (≤088) | ha | — |

Jami: 94

## 5. Xato kodlari (ERR_*) — qaysi funksiyada, birinchi paydo bo'lgan migration

| Kod | Birinchi migration | Funksiya(lar) |
|---|---|---|
| `ERR_ALREADY_REVERSED` | 91 *(deploy qilinmagan)* | `rpc_reverse_seller_lom_purchase` |
| `ERR_AMOUNT` | 77 | `rpc_record_currency_sale`, `rpc_record_seller_lom_purchase` |
| `ERR_AMOUNT_REQUIRED` | 89 *(deploy qilinmagan)* | `_goldia_opening_return_calc` |
| `ERR_BACKUP_BEFORE_FREEZE` | 87 | `_goldia_guard_restart_t0` |
| `ERR_BACKUP_NOT_VERIFIED` | 85 | `rpc_financial_restart` |
| `ERR_BASELINE_IMMUTABLE` | 48 | `trg_prevent_accounting_baseline_mutation` |
| `ERR_BEFORE_OPENING_LOCK` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale`, `rpc_record_seller_lom_purchase` |
| `ERR_CONFIRMATION` | 85 | `rpc_financial_restart` |
| `ERR_CONFIRM_REQUIRED` | 89 *(deploy qilinmagan)* | `rpc_record_opening_sale_return` |
| `ERR_CONSIGNMENT_NO_RECEIPT` | 90 *(deploy qilinmagan)* | `_goldia_restore_consignment_receipts`, `rpc_reverse_barcode_consignment` |
| `ERR_CONSIGNMENT_PARTIALLY_USED` | 70 | `rpc_record_client_jewelry_sale` |
| `ERR_CONSIGNMENT_RECEIPT_UNKNOWN` | 90 *(deploy qilinmagan)* | `_goldia_restore_consignment_receipts` |
| `ERR_CONSIGNMENT_RESTORE_EXCEEDS` | 90 *(deploy qilinmagan)* | `_goldia_restore_consignment_receipts` |
| `ERR_CURRENCY` | 77 | `rpc_record_client_currency_settlement`, `rpc_record_currency_sale` |
| `ERR_CURRENCY_NO_MARKUP` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
| `ERR_CUSTOMER_ARCHIVED` | 79 | `_goldia_guard_sale_archived_customer` |
| `ERR_DAILY_RATE_NOT_SET` | 44 | `_goldia_assert_seller_rate`, `rpc_confirm_accounting_baseline`, `rpc_record_client_settlement` |
| `ERR_EDIT_FAILED` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
| `ERR_EDIT_NO_CHANGE` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
| `ERR_EDIT_UNSUPPORTED` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
| `ERR_EXPLANATION_REQUIRED` | 89 *(deploy qilinmagan)* | `rpc_record_seller_till_count` |
| `ERR_FACTORY_SETTLED_SOURCE` | 88 | `rpc_record_opening_document` |
| `ERR_FACTORY_SETTLED_ZERO` | 88 | `rpc_record_opening_document` |
| `ERR_FINANCIAL_FREEZE` | 86 | `_goldia_guard_baseline_freeze`, `_goldia_guard_opening_draft`, `rpc_record_seller_lom_purchase`, `rpc_reverse_seller_lom_purchase` |
| `ERR_FINANCIAL_TRANSACTION_IMMUTABLE` | 48 | `trg_prevent_financial_transaction_mutation` |
| `ERR_FINISHED_GOODS_HANDOVER` | 90 *(deploy qilinmagan)* | `_goldia_guard_finished_goods_handover` |
| `ERR_FREEZE` | 86 | `_goldia_financial_freeze` |
| `ERR_FREEZE_ALREADY_USED` | 87 | `_goldia_guard_restart_t0` |
| `ERR_FREEZE_REQUIRED` | 86 | `_goldia_guard_restart_t0` |
| `ERR_FUTURE_DATE` | 91 *(deploy qilinmagan)* | `rpc_record_seller_lom_purchase` |
| `ERR_GRAMS` | 91 *(deploy qilinmagan)* | `rpc_record_seller_lom_purchase` |
| `ERR_GRAM_SALE_NO_AMOUNT` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
| `ERR_IDEMPOTENCY` | 85 | `rpc_financial_restart`, `rpc_record_opening_document` |
| `ERR_IDEMPOTENCY_REQUIRED` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale`, `rpc_record_seller_lom_purchase`, `rpc_reverse_seller_lom_purchase` |
| `ERR_INSUFFICIENT_CASH_BALANCE` | 43 | `rpc_record_seller_lom_purchase`, `rpc_record_seller_to_manager_settlement` |
| `ERR_INSUFFICIENT_SCRAP_BALANCE` | 43 | `rpc_record_seller_to_manager_settlement` |
| `ERR_INSUFFICIENT_SELLER_STOCK` | 45 | `rpc_record_currency_sale`, `rpc_record_weight_sale` |
| `ERR_INSUFFICIENT_USD_BALANCE` | 45 | `rpc_record_seller_to_manager_settlement` |
| `ERR_INSUFFICIENT_VAULT_CAPITAL_PURE` | 61 | `rpc_record_factory_gold_handover` |
| `ERR_INSUFFICIENT_VAULT_CASH` | 43 | `rpc_record_gold_purchase` |
| `ERR_INSUFFICIENT_VAULT_PURCHASED` | 61 | `rpc_record_factory_gold_handover` |
| `ERR_INSUFFICIENT_VAULT_REFINED` | 61 | `rpc_record_factory_gold_handover` |
| `ERR_INSUFFICIENT_VAULT_SCRAP` | 61 | `rpc_record_factory_gold_handover` |
| `ERR_INSUFFICIENT_VAULT_USD` | 46 | `rpc_record_gold_purchase` |
| `ERR_INVALID_DESTINATION` | 56 | `rpc_reclassify_capital_transaction` |
| `ERR_LOM_ALREADY_USED` | 91 *(deploy qilinmagan)* | `rpc_reverse_seller_lom_purchase` |
| `ERR_MARKUP_OUT_OF_RANGE` | 65 | `rpc_record_barcode_piece_sale`, `rpc_record_client_jewelry_sale`, `rpc_record_weight_sale` |
| `ERR_MARKUP_REQUIRED` | 65 | `rpc_record_barcode_piece_sale`, `rpc_record_weight_sale` |
| `ERR_NOT_FOUND` | 91 *(deploy qilinmagan)* | `rpc_reverse_seller_lom_purchase` |
| `ERR_NOT_IN_STOCK` | 90 *(deploy qilinmagan)* | `rpc_return_goods_to_factory` |
| `ERR_NOT_OWN_SALE` | 90 *(deploy qilinmagan)* | `_goldia_guard_seller_sale_cancel`, `rpc_edit_client_sale` |
| `ERR_NOT_OWN_TILL` | 91 *(deploy qilinmagan)* | `rpc_record_seller_lom_purchase`, `rpc_reverse_seller_lom_purchase` |
| `ERR_NOT_RECORDED_BY_SELLER` | 90 *(deploy qilinmagan)* | `_goldia_guard_seller_sale_cancel` |
| `ERR_NO_OPENING_DEBT` | 89 *(deploy qilinmagan)* | `_goldia_opening_return_calc` |
| `ERR_NO_OPENING_PERIOD` | 85 | `rpc_record_opening_document` |
| `ERR_OPENING_CONSIGNMENT` | 90 *(deploy qilinmagan)* | `rpc_reverse_barcode_consignment` |
| `ERR_OPENING_DEBT_OTHER_SELLER` | 88 | `rpc_record_client_currency_settlement` |
| `ERR_OPENING_DRAFT` | 85 | `_goldia_guard_opening_draft`, `rpc_record_seller_lom_purchase`, `rpc_reverse_seller_lom_purchase` |
| `ERR_OPENING_DUPLICATE` | 85 | `rpc_record_opening_document` |
| `ERR_OPENING_FACTORY_NEGATIVE` | 85 | `_goldia_vault_factory_add` |
| `ERR_OPENING_LOCKED` | 85 | `rpc_cancel_opening_document`, `rpc_record_opening_document` |
| `ERR_OPENING_NOT_RECONCILED` | 85 | `rpc_confirm_accounting_baseline` |
| `ERR_OPENING_SELLER_TILL_NOT_EMPTY` | 85 | `rpc_confirm_accounting_baseline` |
| `ERR_ORGANIZATION_REQUIRED` | 74 | `rpc_create_jewelry_model` |
| `ERR_PCT_MISMATCH` | 90 *(deploy qilinmagan)* | `rpc_return_goods_to_factory` |
| `ERR_PCT_REQUIRED` | 89 *(deploy qilinmagan)* | `_goldia_opening_return_calc` |
| `ERR_PERIOD_CLOSED` | 90 *(deploy qilinmagan)* | `_goldia_guard_seller_sale_cancel`, `rpc_edit_client_sale`, `rpc_record_seller_lom_purchase`, `rpc_reverse_seller_lom_purchase` |
| `ERR_PIECES_TOO_LIGHT` | 73 | `_goldia_consume_selected_pieces`, `rpc_record_currency_sale`, `rpc_record_weight_sale` |
| `ERR_PIECE_DUPLICATE` | 73 | `rpc_record_currency_sale`, `rpc_record_weight_sale` |
| `ERR_PIECE_EXTRA` | 73 | `rpc_record_weight_sale` |
| `ERR_PIECE_NOT_AVAILABLE` | 73 | `_goldia_consume_selected_pieces`, `rpc_record_currency_sale`, `rpc_record_weight_sale` |
| `ERR_PIECE_WEIGHT_FIXED` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
| `ERR_PRICE_MISMATCH` | 91 *(deploy qilinmagan)* | `rpc_record_seller_lom_purchase` |
| `ERR_PRICE_REQUIRED` | 91 *(deploy qilinmagan)* | `rpc_record_seller_lom_purchase` |
| `ERR_PROBA` | 91 *(deploy qilinmagan)* | `rpc_record_seller_lom_purchase` |
| `ERR_PROBA_REQUIRED` | 91 *(deploy qilinmagan)* | `rpc_record_seller_lom_purchase` |
| `ERR_RATE_INVALID` | 72 | `_goldia_validate_rate_value`, `rpc_set_my_seller_rates` |
| `ERR_RATE_MISMATCH` | 65 | `_goldia_assert_seller_rate` |
| `ERR_RATE_OUT_OF_RANGE` | 72 | `_goldia_operation_rate`, `_goldia_validate_rate_value`, `rpc_set_my_seller_rates` |
| `ERR_RATE_PARTIAL` | 88 | `rpc_record_opening_document` |
| `ERR_RATE_REQUIRED` | 77 | `_goldia_operation_rate`, `rpc_record_client_currency_settlement`, `rpc_record_client_settlement`, `rpc_record_financial_transaction` |
| `ERR_REASON` | 56 | `rpc_financial_restart` |
| `ERR_REASON_REQUIRED` | 56 | `rpc_edit_client_sale`, `rpc_reclassify_capital_transaction`, `rpc_reverse_seller_lom_purchase` |
| `ERR_RECEIPT_OVERFLOW` | 90 *(deploy qilinmagan)* | `rpc_reverse_factory_goods_return` |
| `ERR_RESTART_ALREADY_OPEN` | 85 | `rpc_financial_restart` |
| `ERR_RETURN_GOODS_USED` | 89 *(deploy qilinmagan)* | `rpc_reverse_opening_sale_return` |
| `ERR_RETURN_LOT` | 90 *(deploy qilinmagan)* | `rpc_reverse_barcode_consignment` |
| `ERR_SALE_ALREADY_REVERSED` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
| `ERR_SALE_HAS_PAYMENTS` | 90 *(deploy qilinmagan)* | `_goldia_guard_seller_sale_cancel` |
| `ERR_SALE_HAS_RETURNS` | 83 | `_goldia_guard_sale_reversal_with_returns`, `rpc_edit_client_sale` |
| `ERR_SALE_LINKED_PIECE_MOVED` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
| `ERR_SALE_NOT_FOUND` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
| `ERR_SELLER_KEEP_NOT_DOCUMENTED` | 89 *(deploy qilinmagan)* | `rpc_record_opening_sale_return` |
| `ERR_SELLER_PCT_NOT_USED` | 89 *(deploy qilinmagan)* | `rpc_record_opening_sale_return` |
| `ERR_SELLER_REQUIRED` | 56 | `rpc_record_seller_lom_purchase` |
| `ERR_SETTLED_GOODS` | 90 *(deploy qilinmagan)* | `rpc_return_goods_to_factory` |
| `ERR_T0` | 85 | `rpc_financial_restart` |
| `ERR_T0_BEFORE_FREEZE` | 86 | `_goldia_guard_restart_t0` |
| `ERR_T0_FUTURE` | 86 | `_goldia_guard_restart_t0` |
| `ERR_T0_TOO_OLD` | 86 | `_goldia_guard_restart_t0` |
| `ERR_TILL_ALREADY_HANDED_OVER` | 77 | `rpc_reverse_client_currency_settlement` |
| `ERR_TILL_EMPTY` | 91 *(deploy qilinmagan)* | `rpc_record_seller_lom_purchase` |
| `ERR_USD_RATE_NOT_SET` | 45 | `rpc_confirm_accounting_baseline`, `rpc_record_financial_transaction` |
| `ERR_USE_FINANCIAL_RESTART` | 85 | `rpc_execute_full_test_reset` |
| `ERR_VALUE_NOT_POSITIVE` | 90 *(deploy qilinmagan)* | `rpc_edit_client_sale` |
