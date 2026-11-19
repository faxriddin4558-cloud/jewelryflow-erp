# 13. Texnik arxitektura

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

## 1. Texnologiyalar

| Qatlam | Texnologiya | Manba |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS | `package.json` |
| Backend | Supabase (PostgreSQL + Auth + RLS), `@supabase/supabase-js` 2.x | `src/lib/supabase/*` |
| Biznes mantiq | PostgreSQL PL/pgSQL `SECURITY DEFINER` RPC funksiyalari | `supabase/migrations/*.sql` |
| Testlar | Vitest (PGlite bilan haqiqiy SQL), Playwright e2e | `src/lib/__tests__`, `e2e/` |
| Release | PowerShell (`scripts/goldia-release.ps1`), Node skriptlar, read-only SQL tekshiruvlar | `scripts/`, `supabase/release/` |

## 2. Kod tuzilmasi (Goldia Sales qismi)

```
src/app/sales/
  app/layout.tsx            — chap menyu, rol bo'yicha navigatsiya, kunlik kurs kartasi
  app/page.tsx              — Asosiy panel (menejer) / SellerDashboard (sotuvchi)
  app/<sahifa>/page.tsx     — 20 ichki sahifa (factory, inventory, consignments, sellers, stock-movements, scan,
                              customers, cash, kassam, markup, refining, purchases, period-report, opening,
                              reports, models, users, settings, factory-receive, handovers)
  director/, login/, mobile/, page.tsx
src/components/sales/        — 30 komponent (DirectorSalesWorkspace 4213 qator, CustomerLedgerAndSheetsSection 3026,
                              SellerMobileWorkspace 2049, ProfitAccountingBanner 1430, modallar ...)
src/lib/                     — sales-role-access, customer-balance, factory-account-summary, seller-card-metrics,
                              sales-payment-rates, payment-hints, business-date, goldia-089-ui, erp-engine
supabase/migrations/         — 91 migration (001–025 ERP/ishlab chiqarish, 026+ savdo, 043+ "goldia")
supabase/rollback/           — rollback skriptlari
supabase/release/            — postflight / parity / audit read-only SQL
```

## 3. Ma'lumotlar bazasi — asosiy savdo jadvallari

| Jadval | Migration | Vazifa |
|---|---|---|
| `daily_gold_rates` | 026 | Kunlik 585 kurs |
| `seller_consignments` | 026 | Sotuvchiga berilgan partiyalar |
| `consignment_pieces` | 028 | Donalar (holat, vazn, sotuvchi) |
| `jewelry_sales` | 026 | Savdolar |
| `gold_settlements` | 026 | SETTL va STL-MGR (yo'nalish bilan) |
| `client_gold_accounts` | 026 | Mijoz 585 qarz/avans |
| `seller_gold_accounts` | 026 | Sotuvchi majburiyati, ombori, kassasi, havza |
| `sales_markup_presets` | 027 | Ustama presetlari |
| `manager_vault_account` | 032 | Menejer seyfi va zavod hisobi |
| `factory_receipts`, `factory_gold_handovers` | 032 | Zavod kirimi / topshirish |
| `refining_batches`, `gold_purchases` | 032 | Afinaj / xarid |
| `accounting_baselines`, `financial_transactions` | 047 | Baseline, kapital/xarajat |
| `client_legacy_debts` | 051 | Eski qarzlar |
| `company_rate_differences` | 066 | Kompaniya kurs farqi |
| `weight_sale_allocations` | 068 | Vazn savdosi ↔ donalar |
| `seller_rates`, `seller_rate_history`, `seller_rate_limits` | 072 | Sotuvchi kurslari |
| `client_currency_accounts`, `client_currency_settlements` | 077 | So'm/USD qarzlar va CPAY |
| `goldia_report_periods` | 077 | Hisobot davrlari |
| `jewelry_sale_returns` | 083 | Vozvratlar |
| `financial_restarts`, `financial_restart_items`, `financial_backup_verifications`, `opening_periods`, `opening_documents` | 085 | Restart va boshlang'ich hisob |
| `financial_write_freezes` | 086 | Freeze |
| `opening_sale_returns`, `seller_till_counts` | 089 | *(deploy qilinmagan)* |
| `consignment_receipt_allocations`, `factory_goods_returns`, `sale_edits` | 090 | *(deploy qilinmagan)* |
| `seller_lom_purchases` | 091 | *(deploy qilinmagan)* |

Jami (migration fayllaridan): 82 ta `CREATE TABLE`, 202 ta funksiya (120 ta `rpc_*`); frontend 101 ta RPC/helper'ni chaqiradi (ERP qismi bilan).

## 4. Xavfsizlik va to'g'rilik mexanizmlari

| Mexanizm | Qayerda | Maqsad |
|---|---|---|
| `SECURITY DEFINER` + `set search_path` | barcha RPC | Biznes qoidasi faqat serverda |
| `assert_erp_permission` | 016 | Rol va faol xodim tekshiruvi |
| `current_organization_id()` | 020 | Tashkilot izolyatsiyasi |
| RLS | 014, 017, 036, 069, 074, 075 | Jadval darajasida o'qish/yozish |
| Idempotentlik (`check_and_lock_idempotency`, `save_idempotency_response`) | 016 | Takror so'rov bir marta |
| `pg_advisory_xact_lock('goldia_seller_stock:'+seller)` | savdo RPC'lari | Bir donani ikki marta sotmaslik |
| Qulf tartibi (seyf → sotuvchi hisobi) | topshiruv | Deadlock oldini olish |
| `FOR UPDATE` qator qulflari | ko'p RPC | Parallel yozuvlar |
| Triggerlar: opening draft / freeze guard (12 jadval) | 085/086 | Restart paytida yozuvni to'xtatish |
| `_goldia_guard_sale_archived_customer`, `_goldia_guard_customer_assignment`, `_goldia_guard_customer_archive` | 078/079 | Mijoz qoidalari |
| `_goldia_guard_sale_reversal_with_returns` | 083 | Vozvratli savdoni butun bekor qilmaslik |
| `_goldia_guard_seller_sale_cancel` | 090 | Sotuvchi bekor qilish cheklovi |
| `trg_prevent_financial_transaction_mutation`, `trg_prevent_accounting_baseline_mutation` | 047/077 | O'chirishni taqiqlash |
| `audit_logs` | 012+ | Har bir muhim amal |
| Claude sessiya hook'lari | `.claude/hooks/*` | Production loyihasiga yozishni bloklash (faqat staging) |

## 5. Hisoblash manbai qayerda?

- **Server** — barcha balanslar (RPC + `recalc_seller_gold_account`). Frontend faqat ko'rsatadi; chekdagi ayrim hisoblar (`GoldEngine.calculate...` `erp-engine.ts`) faqat ko'rinish uchun.
- **Saqlangan ustunlar vs hujjatlardan qayta hisob:** sotuvchi majburiyati/ombori hujjatlardan qayta hisoblanadi; menejer seyfi va mijoz hisoblari inkremental yangilanadi; davriy hisobot (`_goldia_period_effects`) hujjatlardan qayta quriladi va saqlangan qoldiq bilan solishtiriladi.

## 6. Muhitlar

| Muhit | Holat (hisobotlar bo'yicha) | Izoh |
|---|---|---|
| Production | DB 088 | Faqat egasining PowerShell release'i bilan; Claude sessiyalaridan bloklangan |
| Staging | Release hisobotlarida 090/091 E2E "rolled back" va lokal; staging'ning aniq darajasi — NOT VERIFIED | `RELEASE-090/091-REPORT.md` |
| Lokal | PostgreSQL 17 / PGlite, 001→091 | Testlar va mashqlar |

## 7. Release jarayoni (qisqacha)

`docs/releases/RELEASE.md` va hisobotlar: staging → production; har migration uchun: to'liq backup (089'dan majburiy, qisman backup taqiqlangan), tiklash va fingerprint, zanjir, postflight, function-body parity, RLS tekshiruvi, emergency rollback. UI-only rejim (`-UiOnly`) faqat DB darajasi aniq mos bo'lsa. Backup paytida biznes yozuv bo'lsa NO-GO (`f6fedcc`).
