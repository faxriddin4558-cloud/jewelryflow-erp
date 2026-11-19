# Goldia Sales — 7-to'plam: Texnik arxitektura, versiyalar, testlar, manbalar, qarama-qarshiliklar, audit
> Ushbu to'plam quyidagi fayllarni birlashtiradi: README.md, 13-technical-architecture.md, 14-releases-and-known-limitations.md, 17-verified-test-scenarios.md, 18-source-index.md, CONFLICTS.md, AUDIT-REPORT.md. Tekshirilgan kod: commit `052ad17`, schema `20260101000091`; production 088 (NOT VERIFIED). Sana: 2026-11-19. Barcha misollar sintetik.


---

<!-- manba fayl: README.md -->

## Goldia Sales — NotebookLM bilim bazasi

> **Tekshiruv pasporti**
> - Kod: Git commit `052ad17` — branch `claude/goldia-sales-staging-audit-qtrq1d` (2026-11-19 12:11 UTC). Hujjatlar shu kod ustida, alohida branch'da (`claude/goldia-notebooklm-docs-2t12zc`) faqat `docs/notebooklm-goldia/` papkasi qo'shilgan.
> - Schema: migration `20260101000091` (kodda eng so'nggi).
> - Production: **088** — release hisobotlari bo'yicha (`docs/audits/goldia-077/RELEASE-089-REPORT.md`, `RELEASE-090-REPORT.md`, `RELEASE-091-REPORT.md`). Bu ish davomida production'ga **ulanilmagan** (strict read-only); shuning uchun production darajasi **NOT VERIFIED**.
> - Testlar: lokal `npx vitest run` — **62 fayl / 521 test PASS** (2026-11-19).
> - Maxfiylik: real mijoz ismlari, telefonlar, tranzaksiyalar, qoldiqlar, kalitlar va parollar **ko'chirilmagan**; barcha misollar sintetik. Skrinshotlar lokal test muhitidan (sintetik "AUDIT"/"RR84"/"RT83" foydalanuvchilar).

### 1. Fayllar

| Fayl | Mazmuni |
|---|---|
| `01-overview.md` | Ilova nima, qarz zanjiri, birliklar, menyu xaritasi, hujjat prefikslari, production/deploy holati |
| `02-roles-permissions.md` | Rollar, sotuvchi cheklovlari, amallar bo'yicha huquqlar jadvali (database bo'yicha) |
| `03-sales.md` | 4 xil savdo: vazn, dona (skaner), so'm/dollar narx, partiya; formulalar va xatolar |
| `04-customer-debts.md` | Mijoz balansi modeli (585/UZS/USD), avans, Mijozlar sahifasi, yangi mijoz, arxiv, eski qarz, boshlang'ich qarz |
| `05-payments-currency-lom.md` | 585 proba, LOM, SETTL, CPAY, USD/UZS konvertatsiya, kassa topshiruvi, havza, kurslar, LOM xaridi, kassa sanog'i, valyuta tuzatish |
| `06-inventory-consignment.md` | Menejer/sotuvchi ombori, Scanner 564 tarqatish, donalar, qaytarish, konsignatsiya reversali, ombor harakati |
| `07-factory-manager-accounting.md` | Zavod kirimi va topshirish, C2 xatosi, kartalar, xarid, afinaj, kapital/xarajat, zavodga tovar qaytarish, boshlang'ich hisob/restart/freeze |
| `08-returns-reversals.md` | Barcha bekor qilish va vozvratlar — ta'sirlangan hisoblar jadvallari bilan |
| `09-dashboard-reports.md` | Asosiy panel, sotuvchi paneli, Bozor qarzi, davriy hisobot, foyda formulasi, ustama farqi |
| `10-complete-user-manual.md` | Sahifama-sahifa qo'llanma (20+ sahifa), kunlik ish tartibi |
| `11-business-formulas.md` | 53 ta formula/qoida, har biri sonli misol va manba bilan |
| `12-faq-troubleshooting.md` | **120 ta savol-javob** + muammolarni hal qilish jadvali |
| `13-technical-architecture.md` | Texnologiyalar, kod tuzilmasi, jadvallar, xavfsizlik mexanizmlari |
| `14-releases-and-known-limitations.md` | Production darajasi dalillari, migratsiyalar xronologiyasi, ma'lum muammolar va cheklovlar |
| `15-glossary.md` | Lug'at (ilovadagi real atamalar) |
| `16-end-to-end-business-examples.md` | 10 ta to'liq sintetik misol (zanjir, valyuta, bekor qilish, vozvrat, F qarz, foyda, ustama farqi) |
| `17-verified-test-scenarios.md` | Ishga tushirilgan testlar natijasi, ssenariylar, 15 ta biznes invariant |
| `18-source-index.md` | Savol → hujjat → kod xaritasi; sahifa → komponent → RPC; **94 ta savdo RPC** indeksi; xato kodlari |
| `CONFLICTS.md` | 14 ta qarama-qarshi/noaniq qoida (tuzatilmagan, egasining qarori kerak) |
| `AUDIT-REPORT.md` | Mustaqil auditor tekshiruvi: nima tekshirildi, nima tuzatildi, nima tasdiqlanmagan |
| `screenshots/` | 10 ta sintetik skrinshot |
| `bundles/` | NotebookLM'ga yuklash uchun 7 ta birlashtirilgan PDF (va ularning Markdown manbalari) |

### 2. Muhim biznes savoliga javob qayerda?

| Savol | Fayl |
|---|---|
| "Mijoz qarzi qanday hisoblanadi?" | 03 §1, 04 §1, 11 §D |
| "Mijoz dollarda to'lasa nima bo'ladi?" | 05 §3–4, 11 §E |
| "585 proba / LOM / fizik vazn nima?" | 05 §1, 15 |
| "Sotuvchining majburiyati (Bozor qarzi) qanday?" | 06 §3, 09 §3, 11 §C |
| "Kassa topshirishda kurs o'zgarsa?" | 05 §5, 16 Misol 1 |
| "Savdo bekor qilinsa qaysi hisoblar o'zgaradi?" | 08 §1, 16 Misol 3 |
| "To'lov qaytarilsa (bekor qilinsa)?" | 08 §4, 16 Misol 8 |
| "Konsignatsiya reversalida nima bo'ladi?" | 06 §7, 08 §5, 16 Misol 5 |
| "Zavod qarzi va avansi qanday?" | 07 §2–4 |
| "Foyda qanday hisoblanadi?" | 09 §5, 16 Misol 9 |
| "Bu funksiya production'da bormi?" | 01 §7, 14 |
| "Bu tugma qayerda / nima qiladi?" | 10, 18 §2 |
| "Bu xato nimani bildiradi?" | 12, 18 §5 |

### 3. NotebookLM'ga nima yuklash kerak

**Tavsiya (eng qulay): `bundles/` papkasidagi 7 ta PDF:**
1. `bundles/01-umumiy-rollar-qollanma.pdf` — 01, 02, 10, 15
2. `bundles/02-savdo-mijozlar.pdf` — 03, 04
3. `bundles/03-tolov-valyuta-lom.pdf` — 05
4. `bundles/04-ombor-zavod-boshlangich.pdf` — 06, 07
5. `bundles/05-bekor-qilish-hisobotlar.pdf` — 08, 09
6. `bundles/06-formulalar-misollar-faq.pdf` — 11, 16, 12
7. `bundles/07-texnik-versiyalar-testlar-manbalar.pdf` — 13, 14, 17, 18, CONFLICTS, AUDIT-REPORT, README

PDF'lar skrinshotlarni o'z ichiga oladi. Agar NotebookLM PDF'ni yaxshi o'qimasa — xuddi shu tarkibdagi `bundles/*.md` fayllarini yuklang (Markdown, rasmsiz). Yoki barcha 21 ta `.md` faylni alohida yuklash mumkin (NotebookLM manbalar soni chegarasiga e'tibor bering).

### 4. Belgilar

- **[089] / [090] / [091]** yoki "deploy qilinmagan" — kodda bor, production'da hali yo'q.
- **NOT VERIFIED** — kod/test bilan tasdiqlab bo'lmagan da'vo.
- **Manba** — `fayl:qator`, RPC nomi (eng so'nggi migration raqami qavsda) yoki test nomi.


---

<!-- manba fayl: 13-technical-architecture.md -->

## 13. Texnik arxitektura

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

### 1. Texnologiyalar

| Qatlam | Texnologiya | Manba |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS | `package.json` |
| Backend | Supabase (PostgreSQL + Auth + RLS), `@supabase/supabase-js` 2.x | `src/lib/supabase/*` |
| Biznes mantiq | PostgreSQL PL/pgSQL `SECURITY DEFINER` RPC funksiyalari | `supabase/migrations/*.sql` |
| Testlar | Vitest (PGlite bilan haqiqiy SQL), Playwright e2e | `src/lib/__tests__`, `e2e/` |
| Release | PowerShell (`scripts/goldia-release.ps1`), Node skriptlar, read-only SQL tekshiruvlar | `scripts/`, `supabase/release/` |

### 2. Kod tuzilmasi (Goldia Sales qismi)

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

### 3. Ma'lumotlar bazasi — asosiy savdo jadvallari

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

### 4. Xavfsizlik va to'g'rilik mexanizmlari

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

### 5. Hisoblash manbai qayerda?

- **Server** — barcha balanslar (RPC + `recalc_seller_gold_account`). Frontend faqat ko'rsatadi; chekdagi ayrim hisoblar (`GoldEngine.calculate...` `erp-engine.ts`) faqat ko'rinish uchun.
- **Saqlangan ustunlar vs hujjatlardan qayta hisob:** sotuvchi majburiyati/ombori hujjatlardan qayta hisoblanadi; menejer seyfi va mijoz hisoblari inkremental yangilanadi; davriy hisobot (`_goldia_period_effects`) hujjatlardan qayta quriladi va saqlangan qoldiq bilan solishtiriladi.

### 6. Muhitlar

| Muhit | Holat (hisobotlar bo'yicha) | Izoh |
|---|---|---|
| Production | DB 088 | Faqat egasining PowerShell release'i bilan; Claude sessiyalaridan bloklangan |
| Staging | Release hisobotlarida 090/091 E2E "rolled back" va lokal; staging'ning aniq darajasi — NOT VERIFIED | `RELEASE-090/091-REPORT.md` |
| Lokal | PostgreSQL 17 / PGlite, 001→091 | Testlar va mashqlar |

### 7. Release jarayoni (qisqacha)

`docs/releases/RELEASE.md` va hisobotlar: staging → production; har migration uchun: to'liq backup (089'dan majburiy, qisman backup taqiqlangan), tiklash va fingerprint, zanjir, postflight, function-body parity, RLS tekshiruvi, emergency rollback. UI-only rejim (`-UiOnly`) faqat DB darajasi aniq mos bo'lsa. Backup paytida biznes yozuv bo'lsa NO-GO (`f6fedcc`).


---

<!-- manba fayl: 14-releases-and-known-limitations.md -->

## 14. Versiyalar (release) va ma'lum cheklovlar

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

### 1. Production'ning tasdiqlanish darajasi

| Da'vo | Dalil | Holat |
|---|---|---|
| Production DB = 088 | `RELEASE-091-REPORT.md` sarlavhasi "production 088 → 089 → 090 → 091 in one release"; `RELEASE-089-REPORT.md` "DB 088 → 089"; commit `f6fedcc` (egasining 089 release logi: backup paytida production'da yozuv bo'lgani uchun NO-GO) | Hujjatlar bo'yicha; **to'g'ridan-to'g'ri NOT VERIFIED** (bu sessiya production'ga ulanmaydi) |
| 089 production'da yo'q | `f6fedcc` NO-GO; keyingi hisobotlar ham 088 dan release rejalashtiradi | Hujjatlar bo'yicha |
| P0/P1 UI (`28cf104`, `3d87193`) production'da | `b64b76d` UI-only rejim qo'shilgan; bajarilgani haqida hisobot topilmadi | **NOT VERIFIED** |
| Staging darajasi | 090/091 E2E "locally (on 091)", "runs on real staging after the staging release" | **NOT VERIFIED** |

### 2. Migratsiyalar xronologiyasi (Goldia savdo qismi)

| Migration | Mazmun (qisqa) |
|---|---|
| 026–029 | Savdo, konsignatsiya, oltin daftari, ustama presetlari, shtrix-kod donalar, reversallar |
| 032–042 | Sheets pariteti (zavod, xarid, afinaj), rollar/Telegram, dona darajasidagi ombor, xavfsizlik |
| 043–050 | Goldia moliyaviy parite, ko'p valyuta, seyf va kassalar, foyda va baseline, davr qulfi |
| 051–064 | Eski qarz, universal reversallar, skaner vazn modeli, FIFO, kapital, zavod avansi, oylik hisobot, audit tuzatishlari |
| 065 | Blocker/high audit tuzatishlari (foiz majburiy, sotuvchi faqat o'z kassasi, rasmiy kurs) |
| 066 | Kompaniya kurs farqi daftari |
| 067 | Ustama farqi ("Ustama farqi") |
| 068 | Vazn savdosi donalari va zavod hisoblagichlari |
| 069 | Anonim RPC kirishini yopish |
| 070 | Qabul auditi tuzatishlari |
| 071 | Sotuvchi seyf/kompaniya omborini ko'rmaydi |
| 072 | Sotuvchining mustaqil kurslari, qiymatlangan kassa havzasi |
| 073–075 | Release candidate, tashkilot izolyatsiyasi, mijoz kodlari |
| 076 | Eski qarz menejer va sotuvchi uchun, dona tanlash ixtiyoriy |
| 077 | Menejer = direktor, valyuta savdolari, davriy hisobot |
| 078–079 | Mijoz arxivi, davrni qayta ochish, arxivlangan mijozga savdo taqiqi |
| 080–082 | Hisobot tezligi, sotuvchi eski avansi, oylik hisobot ishorali balans |
| 083 | Qisman vozvratlar |
| 084 | Operatsiya kurslari va valyuta baholash |
| 085 | Moliyaviy restart va boshlang'ich hisob |
| 086–087 | Moliyaviy freeze, backup freeze ichida |
| **088** | factory_settled, kurssiz F qarzlar — **production darajasi** |
| 089 | Eski savdo vozvrati, CPAY jurnal, valyuta tuzatish, kassa sanog'i, ombor harakati — *deploy qilinmagan* |
| 090 | Konsignatsiya bekor qilish (taqsimot), zavodga tovar qaytarish, savdo tahriri, sotuvchi bekor cheklovi — *deploy qilinmagan* |
| 091 | Zavod topshiruvi C2 tuzatish, sotuvchi LOM xaridi — *deploy qilinmagan* |

### 3. Production (088) da ma'lum muammolar (tuzatish deploy qilinmagan)

| # | Muammo | Tuzatish | Manba |
|---|---|---|---|
| L1 | Zavodga oltin topshirish `total_factory_handed_over_g` ni topshiruvlar yig'indisiga tenglaydi — boshlang'ich C2 (va C) zavod hisobidan tushadi | 091 (eski qiymatlar tuzatilmaydi) | RELEASE-090 §3, RELEASE-091 §1 |
| L2 | Konsignatsiyani bekor qilish: ko'p kirimli FIFO'da noto'g'ri kirimga qaytarish, vozvratni ikki marta ayirish, davr hisobotida ikki marta sanash, sotuvchi hisobini yangilamaslik, B konsignatsiyani bekor qilish | 090 | RELEASE-090 §1b |
| L3 | Noto'g'ri valyutadagi to'lovni tuzatish uchun ikki alohida amal (bekor + qayta) | 089 | RELEASE-089 |
| L4 | T0 dan oldin sotilgan tovar qaytsa yozish yo'li yo'q | 089 | RELEASE-089 |
| L5 | Menejer omboridan zavodga tovar qaytarish RPC'si yo'q | 090 | RELEASE-090 §1c |
| L6 | Savdoni tahrirlash yo'q (faqat bekor + qayta) | 090 | RELEASE-090 §1d |

### 4. Kod darajasidagi cheklovlar (091 da ham)

- **Rasmiy kurs tarixiy emas:** foyda va baholash joriy/kiritilgan kurs bilan; kurs `daily_gold_rates` ning eng so'nggi (tasdiqlangan) qiymati.
- **Foyda faqat "jonli":** kelajak sanasi bilan foyda so'ralsa — `unsupported_pilot_period` ("Pilot davrida faqat bugungi kungacha..."). Savdo marjasi va kurs farqi alohida ajratilmagan ("pilot_notice").
- **Xarajat faqat menejer kassasidan** (sotuvchi kassasidan chiqim yo'q).
- **Faqat 585 tayyor mahsulot:** boshqa probadagi tayyor mahsulot kirim qilinmaydi.
- **Dona vazni ≤ 1000 g.**
- **Klassik `/sales` sahifasi** — moliyaviy ta'siri bu hujjatda tekshirilmagan (NOT VERIFIED).
- **Takroriy eski qarz** 10 daqiqa oynasi bilan cheklanadi; boshqa takroriy holatlar idempotentlik kaliti bilan.
- **Ombor harakati sahifasi** faqat ko'rsatadi, tuzatmaydi (089).
- **Kunlik kurs** UI'da faqat proba 585 uchun.

### 5. 089/090/091 ni production'ga chiqarish (egasining rejasi, hujjatdan)

Staging release (egasi, Windows PowerShell) → staging tekshiruvi → direktorning alohida yozma roziligi → to'liq production release (`-UiOnly` emas): prelaunch 088 → backup + zanjir 088→091 + postflight → frontend → production-post → read-only smoke. Rollback: `rollback_0xx_with_history.sql` (yangi hujjat yo'q bo'lsa). *Manba: RELEASE-089 §5, RELEASE-091.*


---

<!-- manba fayl: 17-verified-test-scenarios.md -->

## 17. Tekshirilgan test ssenariylari va biznes invariantlar

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

### 1. Bu hujjat tayyorlanishida testlar haqiqatan ishga tushirildi

| Buyruq | Muhit | Natija |
|---|---|---|
| `npm ci --ignore-scripts` keyin `npx vitest run` | Lokal konteyner, PGlite (migrations 001→091, haqiqiy `authenticated` roli va RLS bilan) — **production/staging'ga ulanilmagan** | **62 ta fayl / 521 ta test — hammasi PASS** (2026-11-19, ~50 s) |
| Playwright e2e (`e2e/*.spec.ts`) | Ishlayotgan server va DB talab qiladi | **Ishga tushirilmagan** (NOT RUN) |

**Muhim:** testlar **091 darajasidagi kodni** tekshiradi. 089–091 testlari production'da yo'q funksiyalarni tasdiqlaydi; production (088) xatti-harakati faqat 088 gacha bo'lgan testlar bilan mos keladi.

### 2. Goldia test fayllari (natija — men ishga tushirgan run)

| Fayl | Testlar | Nima tekshiriladi (asosiy ssenariylar) |
|---|---|---|
| `jewelry-sales-calculations.test.ts` | 21 ✓ | 100 g, zavod 8%, mijoz 12% (108 / 112, ko'paytirilmaydi); 112 g qarz − 70 g lom − 18 000 000 so'm @900 000 = 22 g; ortiqcha to'lov avansga; Sheets: 194.75 g @8% = 210.33 g, @12% = 218.12 g |
| `customer-balance.test.ts` | 6 ✓ | signedNet = Σqarz − Σavans; manfiy jami qirqilmaydi |
| `sales-payment-rates.test.ts` | 9 ✓ | Sotuvchi o'z kurslari; 072 dan beri dollar to'lov paytida qiymatlanadi; 084: saqlangan kurs faqat standart |
| `seller-card-metrics.test.ts` | 4 ✓ | Bozor qarzi yo'nalishi va qiymati |
| `factory-account-summary.test.ts` | 4 ✓ | Tovar qarzi, C, C2 + topshiruvlar = seyf; farq yashirilmaydi |
| `payment-hints.test.ts` | 3 ✓ | SETTL/CPAY matnlari, butun dollar ogohlantiruvi |
| `goldia-blocker-high-fixes.test.ts` | 10 ✓ | Yashirin 15% yo'q; sotuvchi begona sotuvchi nomidan sota olmaydi; absurd kurs rad; dona reversali sold_count'ni tiklaydi |
| `goldia-audit-fixes.test.ts` | 9 ✓ | FIFO (100 g → 80/20), vazn savdosi reversal zanjiri, afinaj 10 g @997 = 17.0427 g, xarid reversali bog'langan topshiruv bilan bloklanadi |
| `goldia-acceptance-audit-fixes.test.ts` | 10 ✓ | Kirim idempotent; qisman sotilgan partiya butun sotilmaydi; to'langan savdo reversali → avans; foyda faqat management |
| `goldia-security-hotfix.test.ts` | 7 ✓ | Anonim EXECUTE yo'q; tashkilotlararo o'qish yo'q |
| `goldia-seller-role-access.test.ts` | 11 ✓ | Sotuvchi kompaniya omborini/hisobotlarini o'qiy olmaydi; 5 ta menyu bandi |
| `goldia-weight-sale-pieces.test.ts` | 6 ✓ | 3×100 g dan 200 g: 2 dona sotilgan, 1 qolgan; reversal aniq bir marta |
| `goldia-markup-difference.test.ts` | 9 ✓ | 100 g, 15% vs 12% → −3 g; 20% → +5 g; jami +2 g; majburiyatlar o'zgarmaydi |
| `goldia-rate-difference-and-chain.test.ts` | 12 ✓ | 890 000 so'm 1 g sifatida, 900 000 da xarid → kompaniya −0.0111 g; 880 000 da → +0.0114 g |
| `goldia-seller-rates.test.ts` | 11 ✓ | Mustaqil sotuvchi kurslari; topshiruv kurs o'zgarsa ham aynan to'lov grammini yopadi |
| `goldia-073-release-candidate.test.ts` | 3 ✓ | Toshkent biznes sanasi; dona tanlash qoidasi |
| `goldia-074-tenant-isolation.test.ts` | 5 ✓ | Modellar va yo'qotish sozlamalari izolyatsiyasi |
| `goldia-075-...` | 10 ✓ | Mijoz kodlari tashkilot bo'yicha; 9999+ kesilmaydi |
| `goldia-076-legacy-debt-roles.test.ts` | 5 ✓ | Sotuvchi o'z mijoziga eski qarz — majburiyat 1:1; kamaytirish faqat menejer |
| `goldia-077-parity-currency-report.test.ts` | 5 ✓ | Menejer = direktor; $2000 savdo 20 g; davriy hisobot: boshlang'ich + harakat = yakuniy |
| `goldia-078-customer-archive.test.ts` | 5 ✓ | Arxivda qarz saqlanadi; faqat oxirgi davr qayta ochiladi |
| `goldia-079-archived-sale-and-assignment.test.ts` | 6 ✓ | Arxivlangan mijozga savdo yo'q; sotuvchi mijozni o'tkaza olmaydi |
| `goldia-081-seller-legacy-advance.test.ts` | 8 ✓ | Sotuvchi 12.5 g avans (qarzsiz mijozga); qarzi bor mijozga rad |
| `goldia-083-sale-returns.test.ts` | 8 ✓ | Vozvrat — alohida hujjat; asl savdo qiymati ulushi; naqd qaytarilmaydi |
| `goldia-085-opening-accounting.test.ts` | 14 ✓ | Restart himoyalari, A–J hujjatlar, qulf, keyingi operatsiyalar |
| `goldia-085-d1-chain.test.ts` | 5 ✓ | Zavod → menejer → sotuvchi zanjiri; zavod qarzi ikki marta sanalmaydi |
| `goldia-085-final-rules.test.ts` | 6 ✓ | D-2 (8 600 000 @860 000 → 10 g, farq 0.4444 g), D-3 (avans majburiyatni o'zgartirmaydi), D-6 (20 g @999 = 34.1538 g) |
| `goldia-086-write-freeze.test.ts` | 9 ✓ | Freeze barcha yozuvlarni to'xtatadi; T0 qoidalari |
| `goldia-087-backup-inside-freeze.test.ts` | 6 ✓ | Backup freeze ichida; bitta freeze — bitta restart |
| `goldia-088-factory-settled-unrated-currency.test.ts` | 7 ✓ | factory_settled; kurssiz F to'lov kursida baholanadi |
| `goldia-088-money-model.test.ts` | 7 ✓ | Qisman topshiruv → reversal tartibi (0 g yo'qotish); 25 qismli to'lovda qoldiq yo'q |
| `goldia-089-remaining-features.test.ts` | 14 ✓ | *(deploy qilinmagan)* eski savdo vozvrati, CPAY jurnal, valyuta tuzatish, kassa sanog'i, ombor harakati |
| `goldia-089-ui.test.ts` | 3 ✓ | Jurnal yorliqlari, kassa farqi, tuzatish payload |
| `goldia-090-consignment-factory-seller-cancel.test.ts` | 9 ✓ | *(deploy qilinmagan)* 39.46 g = 16 + 23.46 g aniq qaytarish; zavodga 5 g → zavod −5.5 g (10%) |
| `goldia-090-sale-edit.test.ts` | 6 ✓ | *(deploy qilinmagan)* savdo tahriri |
| `goldia-091-c2-lom-purchase.test.ts` | 8 ✓ | *(deploy qilinmagan)* 5 g LOM 4 500 000 so'mga; 2 g @750 = 2.5641 g; C2 saqlanadi |
| `goldia-chain-compare.test.ts`, `goldia-level.test.ts` | 5 ✓, 6 ✓ | Release vositalari |
| `multi-tenant-security.test.ts` | 19 ✓ | Tashkilot izolyatsiyasi |
| `item-level-inventory-and-sheets.test.ts`, `sheets-import-engine.test.ts`, `dynamic-sales-markups.test.ts`, `business-date.test.ts` | 10, 11, 4, 16 ✓ | Dona darajasidagi ombor, Sheets import, presetlar, sana |

### 3. Asosiy biznes invariantlari (test bilan tasdiqlangan)

| # | Invariant | Test |
|---|---|---|
| I1 | Ustamalar bazaviy vazndan, ko'paytirilmaydi (100 g → zavod 108, sotuvchi 112; 108×1.12 emas) | `jewelry-sales-calculations` |
| I2 | Fizik balans: tarqatilgan = sotilgan + mavjud + qaytarilgan | o'sha |
| I3 | Sotuvchi javonidagi donalar grammi = sotuvchi ombori | `goldia-weight-sale-pieces` |
| I4 | Savdo sotuvchi majburiyatini o'zgartirmaydi; faqat topshiruv kamaytiradi | `goldia-085-opening-accounting` (T), 085 hisobot |
| I5 | Sotuvchiga tarqatish zavod qarzini o'zgartirmaydi | `goldia-085-d1-chain` D1-3 |
| I6 | Topshiruv to'lov paytidagi grammni yopadi; kurs farqi kompaniyaniki va bir marta | `goldia-seller-rates` G/H, `goldia-085-final-rules` D-2 |
| I7 | Mijoz avansi sotuvchi majburiyatiga ta'sir qilmaydi | `goldia-085-final-rules` D-3 |
| I8 | To'langan savdo bekor qilinsa to'lov avansga o'tadi | `goldia-acceptance-audit-fixes` F2 |
| I9 | Vozvratlar yig'indisi savdodan oshmaydi; naqd qaytarilmaydi | `goldia-083-sale-returns` |
| I10 | Davr: boshlang'ich + harakatlar = yakuniy; yopish hech narsani o'zgartirmaydi | `goldia-077` C |
| I11 | Takror so'rov (idempotentlik) ikki marta yozmaydi | ko'p testlar (M3, F5, F7, H) |
| I12 | Tashkilotlar va sotuvchilar bir-birining ma'lumotini ko'rmaydi | `goldia-security-hotfix`, `multi-tenant-security` |
| I13 | Ustama farqi qarz/majburiyat/kassa/foydani o'zgartirmaydi | `goldia-markup-difference` I+L |
| I14 | Boshlang'ich F qarz majburiyati bir marta yaratiladi; to'lov qayta yaratmaydi | `goldia-085-opening-accounting` O3/T |
| I15 | Freeze/draft paytida oddiy moliyaviy yozuvlar rad | `goldia-086-write-freeze` F2, `goldia-085-final-rules` D-4 |

### 4. Qanday qayta ishga tushirish (lokal, xavfsiz)

```bash
npm ci --ignore-scripts
npx vitest run            # yoki: npx vitest run src/lib/__tests__/goldia-083-sale-returns.test.ts
```
Production yoki staging'ga ulanish talab qilinmaydi (PGlite xotirada).


---

<!-- manba fayl: 18-source-index.md -->

## 18. Manbalar indeksi (source index)

> **Tekshiruv pasporti:** commit `052ad17` (branch `claude/goldia-sales-staging-audit-qtrq1d`), schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

### 1. Biznes savoli → javob qayerda

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

### 2. Sahifa → komponent → asosiy RPC

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

### 3. Asosiy loyiha hujjatlari (manba sifatida o'qilgan)

- `docs/audits/goldia-077/RELEASE-089-REPORT.md`, `RELEASE-090-REPORT.md`, `RELEASE-091-REPORT.md` — 089–091 mazmuni va production holati.
- `docs/audits/goldia-077/OPENING-085-REPORT.md` — boshlang'ich hisob qoidalari (A–L).
- `docs/audits/goldia-077/PRODUCTION-088-CORRECTION.md` — 088 qoidalari (**ichida real production raqamlari va ismlar bor — bu hujjatlarga ko'chirilmagan**).
- `docs/releases/RELEASE.md` — release jarayoni.
- Migration fayl boshidagi izohlar (065–091).

### 4. Barcha savdo RPC'lari (avtomatik indeks)

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

### 5. Xato kodlari (ERR_*) — qaysi funksiyada, birinchi paydo bo'lgan migration

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


---

<!-- manba fayl: CONFLICTS.md -->

## CONFLICTS — qarama-qarshi yoki noaniq biznes qoidalari

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.
> Bu fayl hujjatlashtirish jarayonida kod, UI va hisobotlar o'rtasida topilgan nomuvofiqliklarni yig'adi. **Hech biri tuzatilmagan** (documentation-only ish). Har biri uchun manba ko'rsatilgan. Qaror — biznes egasiniki.

| ID | Mavzu | Qarama-qarshilik | Manba | Ta'sir | Holat |
|---|---|---|---|---|---|
| C-01 | `markup_spread_grams` ma'nosi | Vazn savdosida `qarz − vazn` (zavod foizi 0, `factory_gold_due = vazn`); dona savdosida `qarz − vazn × (1 + konsignatsiya zavod%)`; partiya savdosida `qarz − partiya factory_gold_due`. Bir ustun uch xil ma'noda. | `rpc_record_weight_sale` (076), `rpc_record_barcode_piece_sale` (076), `rpc_record_client_jewelry_sale` (076) | Savdolar bo'yicha "spread"/"zavod qismi" ustunlarini turlar orasida solishtirib bo'lmaydi | Tasdiqlangan (kod) |
| C-02 | Zavodga topshirish va C2 | Production (088) kodi `total_factory_handed_over_g` ni topshiruvlar yig'indisiga tenglaydi — boshlang'ich C2/C hisobdan tushadi. 091 delta bilan tuzatadi, lekin **allaqachon buzilgan hisobni tuzatmaydi** ("stays as it is"). | `RELEASE-090-REPORT.md` §3, `RELEASE-091-REPORT.md` §1, `rpc_record_factory_gold_handover` (091) | Production'da zavod hisobi kartalar bilan mos kelmasligi mumkin | Tasdiqlangan (hisobot + kod); production qiymati NOT VERIFIED |
| C-03 | Lom bilan zavodga topshirish | `scrap_gold` manbasida yetarlilik `manager_scrap_grams` (boshqa joylarda 585eq ustuni) bilan **fizik** vazn bo'yicha tekshiriladi va undan fizik vazn ayriladi, `manager_scrap_585_eq_g` dan esa 585eq ayriladi. Proba ≠ 585 bo'lsa ikki ustun ajralib ketadi. | `rpc_record_factory_gold_handover` (091), solishtiring: `rpc_record_seller_to_manager_settlement` (`manager_scrap_grams + 585eq`) | Proba ≠ 585 lom topshirilsa seyf lom ustunlari nomuvofiq | Tasdiqlangan (kod); amaliy ta'siri NOT VERIFIED |
| C-04 | Zavod kirimi standart foizi | Server `p_factory_markup_pct` NULL bo'lsa **8%** oladi; boshlang'ich A hujjatda "zavod foizi har bir hujjatda (default yo'q)". UI har doim qiymat yuboradi (standart 8.00). | `rpc_record_factory_receipt` (070), `OPENING-085-REPORT.md` §2 | API orqali to'g'ridan-to'g'ri chaqirilsa yashirin 8% | Tasdiqlangan (kod) |
| C-05 | Ikki xil konsignatsiya | Scanner 564 (`rpc_issue_barcode_consignment`) sotuvchi majburiyatini **sotuvchi foizi** (12%) bilan hisoblaydi; mahsulot konsignatsiyasi (`rpc_issue_seller_consignment`, faqat `/sales/director`) sotuvchi foizini yozmaydi — majburiyat `factory_gold_due` (zavod foizi) bo'yicha olinadi, `seller_markup_pct` esa ustun standarti 12% bo'lib qoladi (ustama farqi trigger'i shu 12% ni oladi). | `recalc_seller_gold_account` (085), migration 032/034 (`seller_markup_pct default 12`), `trg_goldia_sale_markup_snapshot` | Mahsulot konsignatsiyasidan sotilganda ustama farqi va majburiyat asosi turlicha | Tasdiqlangan (kod); amaliy ishlatilishi NOT VERIFIED |
| C-06 | Sotuvchi savdoni bekor qilishi | Production: sotuvchi o'z savdosini (cheklovsiz) bekor qila oladi. 090: faqat o'zi kiritgan, to'lovsiz, ochiq davrdagi savdo (`_goldia_guard_seller_sale_cancel`). | `rpc_reverse_client_sale` (077), migration 090 | Production'da sotuvchi to'lov qilingan savdoni ham bekor qila oladi (to'langan qism mijoz avansiga o'tadi) | Tasdiqlangan (kod) |
| C-07 | "🤝 Kassa topshiruvi" tugmasi | Asosiy paneldagi tugma `/sales/app/handovers` ga olib boradi — bu sahifa **"Zavodga Oltin Topshirish"** (zavod), sotuvchi kassasini qabul qilish esa "Sotuvchilar & Bozor Qarzi" sahifasida. | `ManagerSimplePanel.tsx`, `src/app/sales/app/handovers/page.tsx` | Foydalanuvchi chalg'ishi mumkin | Tasdiqlangan (kod) |
| C-08 | Kassa topshiruvini kim yozadi | UI: "Topshirishni boshqaruvchi qabul qilib yozadi" (sotuvchida tugma yo'q). Database: sotuvchi ham o'z kassasini topshira oladi (rol ro'yxatida `seller`). | `kassam/page.tsx`, `rpc_record_seller_to_manager_settlement` (085) | API darajasida sotuvchi o'zi topshiruv yoza oladi | Tasdiqlangan (kod) |
| C-09 | Kapital/xarajat standart kursi | Kurs berilmasa `daily_gold_rates` dan **proba filtrisiz** eng so'nggi qator olinadi (boshqa joylarda `proba = 585`). | `rpc_record_financial_transaction` (084) | Boshqa proba kursi bo'lsa noto'g'ri 585eq (UI odatda 585 kursni yuboradi) | Tasdiqlangan (kod) |
| C-10 | "Sotuvchilar majburiyati" jami | Oddiy panel: Σ `seller_owes_manager_g` (faqat qarzdorlar). "Batafsil" bo'lim (2-Daraja): Σ \|`bozor_qarzi_signed_g`\| — menejer qarzdor bo'lgan sotuvchilar ham musbat qo'shiladi. | `ManagerSimplePanel.tsx`, `src/app/sales/app/page.tsx` (`totalSellerObligation`) | Bitta sahifada ikki xil jami | Tasdiqlangan (kod) |
| C-11 | Davr yopilishi | Davriy hisobot sahifasi: yopish "hech narsani o'zgartirmaydi". 090/091: yopilgan davr sanasidagi savdoni sotuvchi bekor qila olmaydi, tahrirlab bo'lmaydi, LOM xaridi yozilmaydi (`ERR_PERIOD_CLOSED`). | `period-report/page.tsx`, 090/091 funksiyalari | 090+ da yopish yozuvlarni cheklaydi (balanslarni emas) | Tasdiqlangan (kod) |
| C-12 | CPAY jurnalda | Production (088) kunlik jurnalida CPAY qatorlari yo'q; 089 qo'shadi. Mijoz valyuta to'lovlari jurnalda ko'rinmasligi mumkin. | `RELEASE-089-REPORT.md`, `rpc_get_daily_sales_ledger` (089) | Hisobot to'liqligi | Hisobot bo'yicha |
| C-13 | Production darajasi | Kodda 091, hisobotlarda production 088; staging darajasi aniq emas; P0/P1 UI production'da ekanligi tasdiqlanmagan. | `14-releases-and-known-limitations.md` §1 | Foydalanuvchi ko'rgan UI hujjatdan farq qilishi mumkin | NOT VERIFIED |
| C-14 | Mijoz foizi standarti | Forma standarti 12.0 va matn "Standart: 12.0% yoki 15.0%"; 065'dan oldin serverda yashirin 15% bo'lgan, endi server foizni majburiy qiladi. Eski hujjatlarda 15% standart haqida gap bo'lishi mumkin. | `CustomerLedgerAndSheetsSection.tsx`, `rpc_record_barcode_piece_sale` izohi | Faqat hujjat/odatlar darajasida | Tasdiqlangan (kod) |

### Hal qilish uchun tavsiya etilgan savollar (biznes egasiga)

1. C-01: "Spread" hisobotlarda qaysi ma'noda ishlatilishi kerak?
2. C-02: Production'dagi C2 farqi bo'yicha hujjatli tuzatish o'tkaziladimi?
3. C-03: Lom bilan zavodga topshirishda yetarlilik fizik yoki 585eq bo'yicha bo'lishi kerakmi?
4. C-05: Mahsulot konsignatsiyasi yo'li hali ishlatiladimi?
5. C-08: Sotuvchi o'z kassasini o'zi topshira olishi kerakmi?
6. C-10: Panelda qaysi jami ko'rsatilishi kerak?


---

<!-- manba fayl: AUDIT-REPORT.md -->

## AUDIT-REPORT — hujjatlarning kodga mustaqil solishtiruvi

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19.

Hujjatlar yozilgandan keyin ular "mustaqil auditor" sifatida kod, migration va testlarga qaytadan solishtirildi. Production'ga hech qanday so'rov yuborilmadi; hech qanday migration, deploy yoki biznes ma'lumotiga yozuv bajarilmadi.

### 1. Avtomatik tekshiruvlar

| Tekshiruv | Usul | Natija |
|---|---|---|
| Hujjatlardagi har bir funksiya nomi (`rpc_*`, `_goldia_*`, `get_*`, `recalc_*`, `trg_*` ...) | 91 ta migration fayldan olingan 202 funksiya indeksi + jadvallar ro'yxati bilan solishtirish | **0 ta topilmagan nom** |
| Har bir xato kodi (`ERR_*`) | 147 ta `raise exception 'ERR_...'` yozuvi indeksi bilan | **0 ta topilmagan kod** |
| `RPC (NNN)` ko'rinishidagi migration raqamlari | Funksiyaning eng so'nggi ta'rifi bilan | **0 ta nomuvofiqlik** |
| Fayl yo'llari | `os.path.exists` | 2 ta qisqartma yo'l → to'liq yo'llar bilan almashtirildi |
| Qo'shtirnoqdagi UI matnlari (537 ta) | `src/`, migrations va audit hujjatlarida normallashtirilgan qidiruv | 476 to'g'ridan-to'g'ri topildi; 61 tasi qo'lda ko'rildi: ko'pchiligi o'zgaruvchili shablon (kodda tasdiqlandi), mening misol savollarim yoki atamalar; **5 ta haqiqiy noaniqlik tuzatildi** (§3) |
| Privatlik skaneri | Real ismlar/raqamlar (production hisobotlaridagi), email, kalit, `service_role`, loyiha ID'lari | **Topilmadi** |
| Testlar | `npx vitest run` (lokal PGlite, 001→091) | **62 fayl / 521 test PASS** |

### 2. Qo'lda chuqur tekshirilgan qoidalar (namuna)

| Da'vo | Tasdiqlovchi manba |
|---|---|
| Savdo sotuvchi majburiyatini o'zgartirmaydi | `recalc_seller_gold_account` (majburiyat = konsignatsiya + eski qarz + boshlang'ich − topshiruv), 085 hisobot |
| SETTL pulini havzaga to'lov grammi bilan kiritish | `trg_goldia_seller_till_pool` (`till_pool_cash_585_g := cash_equivalent_grams`) |
| Topshiruvda qiymatlangan pul havza grammini yopadi, farq kompaniyaniki | `rpc_record_seller_to_manager_settlement` (085) `v_val_cash_g`, `v_rate_diff_g` |
| Vozvrat qarzni, keyin avansni oshiradi; naqd yo'q | `rpc_record_sale_return` (083) |
| Vozvratda sotuvchi majburiyati o'zgarmaydi | konsignatsiya `seller_obligation_g` yangilanmaydi (083) — dastlabki matn tuzatildi |
| Sotuvchi mijozni faqat o'ziga yaratadi | `rpc_create_customer_with_code` 48–49-qatorlar |
| Arxivlangan mijozga savdo taqiqi xabari | `_goldia_guard_sale_archived_customer` (079) |
| Freeze/draft xabarlari va 12 jadval | `_goldia_guard_opening_draft` (086), migration 085 136–141-qatorlar |
| C2 xatosi va 091 tuzatishi | `rpc_record_factory_gold_handover` (091) + RELEASE-090 §3 |
| Kurs chegaralari (100 000–3 000 000; 5 000–30 000; 25%) | `_goldia_seller_rate_limits` (072) |
| `CompanyRateDifferenceCard` joylashuvi | `DirectorSalesWorkspace.tsx` 1290-qator (faqat `/sales/director` banneri) — dastlabki matn tuzatildi |

### 3. Audit natijasida kiritilgan tuzatishlar

1. `08-returns-reversals.md` — vozvratda "majburiyat yangi dona bo'yicha" degan noaniq ibora → "sotuvchi majburiyati o'zgarmaydi" (kod bo'yicha).
2. `07`, `09`, `18` — `CompanyRateDifferenceCard` "Naqdga Oltin Xarid" sahifasida emas, `/sales/director` bannerida.
3. `07` — factory_settled tugmasi real yorlig'i: "Zavod bilan oldin hisob-kitob qilingan".
4. `07` — `ERR_FINANCIAL_TRANSACTION_IMMUTABLE` o'zgartirishni emas, **o'chirishni** taqiqlaydi.
5. `05`, `12` — topshiruvdagi LOM kursi maydonining to'liq yorlig'i; topshiruv oynasidagi alohida yorliqlar.
6. `07` — 084-izohni iqtibos sifatida emas, bayon sifatida.
7. `01` — sarlavha qismlari alohida ko'rsatildi.
8. `13` — sahifalar soni 22 → 20 (ichki sahifa), komponentlar 30.
9. `10` — "📷 Kamera Skaner" tugmasining to'liq nomi.

### 4. Tasdiqlanmagan (NOT VERIFIED) qismlar

| # | Qism | Sabab |
|---|---|---|
| U1 | Production DB darajasi (088) | Production'ga ulanish taqiqlangan/yo'q; faqat release hisobotlari |
| U2 | P0/P1 UI production'da ekanligi | UI-only release bajarilgani haqida dalil yo'q |
| U3 | Staging darajasi | Hisobotlarda aniq emas |
| U4 | Klassik `/sales` sahifasining moliyaviy ta'siri | Tekshirilmagan (asosiy oqim emas) |
| U5 | Chekni keyinchalik qayta ochish yo'li | Topilmadi |
| U6 | C-03 (lom topshiruvi ustunlari) va C-05 (mahsulot konsignatsiyasi) amaliy ta'siri | Real ma'lumot ko'rilmadi |
| U7 | Playwright e2e testlar | Ishga tushirilmagan (server + DB kerak) |
| U8 | Skrinshotlar 077–085 lokal darajasidan; joriy UI biroz farq qilishi mumkin | Yangi skrinshot olinmadi (DB yo'q) |
| U9 | Production'dagi C2 farqining haqiqiy qiymati | Faqat read-only SQL bilan aniqlanadi (`factory_cards_readonly.sql`) |

### 5. Qamrov ko'rsatkichlari

| Ko'rsatkich | Son |
|---|---|
| Hujjatlashtirilgan sahifalar | 20 ta `/sales/app/*` ichki sahifa + `/sales/app` bosh panel + 4 ta qo'shimcha (`/sales/director`, `/sales/login`, `/sales/mobile`, `/sales`) = **25** (qo'llanmada har biri; `/sales` — qisman) |
| Indekslangan savdo RPC'lari | **94** (fayl:qator, holat, hujjat bo'limi bilan; `18-source-index.md` §4) |
| Tanasi to'liq o'qilgan RPC/funksiyalar | ~30 (savdo, to'lov, topshiruv, konsignatsiya, zavod, xarid, afinaj, kapital, vozvrat, reversal, eski qarz, foyda, davr, yordamchi va guard funksiyalar) |
| Qoidalari/rad etish shartlari skanerlangan qo'shimcha RPC'lar | 22 (reversallar, arxiv, davr, kurslar, tahrir, tuzatish, sanoq, LOM xaridi, tovar qaytarish) |
| Biznes qoidalari | 53 formula/qoida (11) + 15 invariant (17) + 39 huquq qatori (02) |
| Xato kodlari | 105 (`18-source-index.md` §5) |
| Savol-javoblar | **120** (`12-faq-troubleshooting.md`) |
| End-to-end misollar | 10 |
| Qarama-qarshiliklar | 14 (`CONFLICTS.md`) |
| Skrinshotlar | 10 (sintetik) |
