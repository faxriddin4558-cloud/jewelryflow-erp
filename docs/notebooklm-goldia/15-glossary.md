# 15. Lug'at (atamalar)

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (NOT VERIFIED). Sana: 2026-11-19.
> Atamalar ilovadagi real yozuvlar bo'yicha; qavsda kod nomi.

| Atama (ilovada) | Ma'nosi | Kod / jadval |
|---|---|---|
| **585 / 585 proba** | 58.5% sof oltinli qotishma; asosiy hisob birligi | `XAU585` |
| **585 ekvivalenti (585 eq)** | Har qanday probadagi oltinning 585 dagi grammi: fizik × proba / 585 | `*_585_eq_g`, `equiv_585_grams` |
| **Fizik vazn / fizik gramm** | Tarozidagi haqiqiy vazn | `*_physical_g` |
| **Sof oltin (fine)** | fizik × proba / 1000 | `fine_gold_grams` |
| **Lom** | Eski/singan oltin (to'lov yoki xarid) | `scrap_*` |
| **Lom kursi / LOM (585) kursi / "Bugungi Lom (585)"** | 1 g 585 oltin narxi (so'm) | `daily_gold_rates.rate_per_gram` |
| **USD kursi / MB kursi** | 1 $ narxi; "MB" — Markaziy bank kursi tugmasi (`/api/sales/currency/cbu`) | `applied_usd_rate`, `rate_usd_uzs` |
| **Rasmiy kurs** | Eng so'nggi tasdiqlangan 585 kurs | `_goldia_official_585_rate` |
| **Operatsiya kursi** | To'lov/topshiruvda kiritilgan va snapshot qilingan kurs (084) | `_goldia_operation_rate` |
| **Mening kurslarim** | Sotuvchining saqlangan LOM/USD kurslari (072) | `seller_rates` |
| **Ustama / foiz** | Bazaviy vaznga qo'shiladigan foiz | `*_markup_pct` |
| **Zavod ustamasi** | Zavod kirimi/konsignatsiyadagi foiz (standart 8%) | `factory_markup_pct` |
| **Sotuvchi majburiyati ustamasi** | Sotuvchiga berilgan tovar foizi (standart 12%) | `seller_markup_pct` |
| **Mijoz ustama foizi** | Mijozga sotishdagi foiz (forma standarti 12%) | `client_markup_pct` |
| **Ustama farqi** | vazn × (mijoz% − tayinlangan sotuvchi%) / 100; kompaniyaniki | `markup_difference_g` |
| **Spread** | Mijoz qarzi − zavod qismi (dona savdosi) yoki − vazn (vazn savdosi) | `markup_spread_grams` |
| **Zavod majburiyati / zavod qarzi** | Menejerning zavodga 585 g qarzi | `current_factory_obligation_g` |
| **Zavoddagi avansimiz** | Zavod bizga qarzdor (ko'p topshirilgan) | `current_factory_advance_g` |
| **Kirim (ZVD)** | Zavoddan kelgan tayyor mahsulot | `factory_receipts` |
| **Zavodga topshirish (HND)** | Zavod qarzini oltin bilan yopish | `factory_gold_handovers` |
| **Konsignatsiya / tarqatish (CONS-BC)** | Menejer omboridan sotuvchiga berish | `seller_consignments` |
| **Scanner 564** | Shtrix-kod skaneri bilan tarqatish/savdo ish oqimi | `ScannerConsignmentSection` |
| **Dona** | Bitta zargarlik buyumi (vazni, modeli) | `consignment_pieces` |
| **Vitrina / javon** | Sotuvchidagi sotilmagan donalar | status `held_by_seller` |
| **Bozor qarzi** | Sotuvchi va menejer o'rtasidagi ishorali balans (manfiy: sotuvchi qarzdor) | `bozor_qarzi_signed_g` |
| **Sotuvchi majburiyati** | Sotuvchining menejerga 585 g qarzi | `seller_owes_manager_g` |
| **Kassa (sotuvchi)** | Sotuvchidagi topshirilmagan lom, so'm, $ | `seller_till_*` |
| **Kassam** | Sotuvchining o'z kassasi sahifasi | `/sales/app/kassam` |
| **Seyf / Menejer seyfi** | Menejerdagi pul, lom, toza oltin | `manager_vault_account` |
| **Topshiruv / Tushum (STL-MGR)** | Sotuvchi kassasini menejer qabul qilishi | `gold_settlements` (`seller_to_manager`) |
| **Qiymatlangan pul havzasi** (hujjat atamasi; kodda "valued till pool") | To'lov paytidagi gramm qiymati saqlangan pul (072) | `till_valued_*` |
| **Kompaniya kurs farqi** | Havzadagi gramm va topshiruv kursidagi gramm farqi | `company_rate_differences`, `company_rate_difference_585_g` |
| **Nasiya** | Qarzga savdo | `jewelry_sales` |
| **Avans / Haqdorlik** | Mijozning ortiqcha to'lovi (biz qarzdormiz) | `advance_balance_grams`, `advance_amount` |
| **Sof qarz** | qarz − avans | `signedNet` |
| **SETTL** | 585 g qarzga to'lov | `rpc_record_client_settlement` |
| **CPAY** | So'm/USD qarzga to'lov | `rpc_record_client_currency_settlement` |
| **Eski qarz** | Daftardan kiritilgan qoldiq | `client_legacy_debts` |
| **Qayta solishtirish** | Daftardagi maqsad qoldiqqa tenglashtirish | `reconciliation_adjustment` |
| **Vozvrat** | Mijozdan tovar qaytishi (qisman/to'liq) | `jewelry_sale_returns` |
| **Bekor qilish / storno** | Hujjatni teskari amal bilan bekor qilish | `rpc_reverse_*` |
| **Arxivlash / "Mijozni o'chirish"** | Soft delete (qarz saqlanadi) | `customers.is_archived` |
| **Afinaj** | Lomni eritib toza oltin olish | `refining_batches` |
| **Pateriya** | Afinajdagi yo'qotish | `total_loss_grams` |
| **Tovar olish** | Naqdga oltin xaridi | `gold_purchases` |
| **Kapital** | Ta'sischi hissasi / foyda taqsimoti | `financial_transactions` |
| **Baseline / "Hisobni boshlash"** | Foyda hisobining boshlang'ich nuqtasi | `accounting_baselines` |
| **T0** | Boshlang'ich hisob vaqti | `opening_periods` |
| **Boshlang'ich hujjat (A–J, C2)** | T0 qoldiqlari | `opening_documents` |
| **factory_settled** | Sotuvchi tovari T0 dan oldin zavod bilan hisoblashilgan (088) | `opening_documents.kind` |
| **Restart (qayta boshlash)** | Moliyaviy hisobni nolga keltirish (arxivlash bilan) | `rpc_financial_restart` |
| **Freeze** | Backup→restart oynasida yozuvlar to'xtatilishi | `financial_write_freezes` |
| **Davr / Hisobot davri** | Yopilgan hisobot nusxasi | `goldia_report_periods` |
| **Idempotentlik kaliti** | Takror so'rovni bir marta bajarish | `p_idempotency_key` |
| **FIFO** | Eng eski kirimdan olish | `rpc_issue_barcode_consignment` |
| **Postflight / parity** | Release'dan keyingi read-only tekshiruvlar | `supabase/release/*` |
