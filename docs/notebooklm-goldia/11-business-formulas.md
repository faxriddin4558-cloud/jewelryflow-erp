# 11. Biznes formulalari (har biri sonli misol bilan)

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19. Misollar sintetik.
> Yaxlitlash: grammlar 4 xona (`numeric(14,4)`, `round(...,4)`), pul 2 xona; havza grammlari 6 xona.

## A. Proba va oltin

| # | Formula | Misol | Manba |
|---|---|---|---|
| F1 | `585eq = fizik × proba / 585` | 10 g 750 → 12.8205 g | `rpc_record_client_settlement` |
| F2 | `sof (fine) = fizik × proba / 1000` | 10 g 750 → 7.5 g | o'sha |
| F3 | Lom probasi ruxsati: 300 ≤ proba ≤ 1000 | 250 → rad | o'sha |
| F4 | Toza oltin 585eq: `fizik × proba / 585` | 20 g 999 → 34.1538 g; sof 19.98 g | test 085 D-6 |

## B. Zavod

| # | Formula | Misol | Manba |
|---|---|---|---|
| F5 | `zavod majburiyati = kirim fizik × (1 + zavod%/100)` | 100 g @8% → 108 g | `rpc_record_factory_receipt` |
| F6 | `zavod neti = Σmajburiyat − Σtopshirilgan`; ≥0 qarz, <0 avans | 108 − 120 → avans 12 g | o'sha / `_goldia_vault_factory_add` |
| F7 | `topshiruv 585eq = fizik × proba / 585` | 10 g 999 → 17.0769 g | `rpc_record_factory_gold_handover` |
| F8 | Kartalar: `tovar qarzi + C − (C2 + topshiruvlar) = seyf neti` | 108 + 0 − (50 + 17.0769) = 40.9231 | `factory-account-summary.ts` |
| F9 | Zavodga tovar qaytarish *(090)*: `qiymat = g × (1 + kirim%)` | 10 g @8% → 10.8 g | `rpc_return_goods_to_factory` |
| F10 | factory_settled *(088)*: B o'z kirimi → `g × (1 + kirim%)`; A'dan olingan B → `g × (1 + A%)` | 50 g, A 8% → 54 g zavod hisobidan ayriladi | migration 088 |

## C. Konsignatsiya va sotuvchi

| # | Formula | Misol | Manba |
|---|---|---|---|
| F11 | `sotuvchi majburiyati = bazaviy × (1 + sotuvchi%/100)` | 15 g @12% → 16.8 g | `rpc_issue_barcode_consignment` |
| F12 | `konsignatsiya zavod qismi = bazaviy × (1 + zavod%/100)` (ma'lumot) | 15 g @8% → 16.2 g | o'sha |
| F13 | Bozor qarzi: `majburiyat = Σkonsignatsiya + max(0,Σeski qarz) + boshlang'ich`; `owes = max(0, majburiyat − Σtopshiruv)` | 16.8 + 5 − 20 = 1.8 g | `recalc_seller_gold_account` |
| F14 | `bozor_qarzi_signed = manager_owes − seller_owes` | sotuvchi 1.8 qarz → −1.8 | o'sha |
| F15 | Sotuvchi ombori: `Σkonsignatsiya bazaviy − Σsavdo vazni + Σvozvrat` | 15 − 10 + 2 = 7 g | `get_seller_available_stock_grams` |
| F16 | Donani qaytarish: `majburiyat −= w × (1 + s%)` | 5 g @12% → −5.6 g | `rpc_return_piece_to_manager` |

## D. Savdo

| # | Formula | Misol | Manba |
|---|---|---|---|
| F17 | Vazn savdosi: `qarz = vazn × (1 + mijoz%/100)` | 10 g @12% → 11.2 g | `rpc_record_weight_sale` |
| F18 | Avans ishlatish: `ishlatilgan = min(avans, qarz)`; `yangi qarz = qarz − ishlatilgan` | qarz 11.2, avans 2 → +9.2 | o'sha |
| F19 | Dona savdosi: `factory_due = w × (1+zavod%)`; `qarz = w × (1+mijoz%)`; `spread = qarz − factory_due` | 5 g, 8%/15% → 5.4 / 5.75 / 0.35 | `rpc_record_barcode_piece_sale` |
| F20 | Vazn savdosida `markup_spread = qarz − vazn` | 11.2 − 10 = 1.2 g | `rpc_record_weight_sale` |
| F21 | Ustama farqi: `farq = vazn × (mijoz% − tayinlangan s%) / 100` | 100 g, 12% vs 15% → −3 g | trigger `trg_goldia_sale_markup_snapshot` |
| F22 | Valyuta savdosi: qarz = summa (valyutada), avans shu valyutadan | 2000 $ − 300 $ avans → 1700 $ | `rpc_record_currency_sale` |
| F23 | Partiya savdosi: `qarz = partiya bazaviy × (1+mijoz%)` | 15 g @15% → 17.25 g | `rpc_record_client_jewelry_sale` |

## E. To'lovlar

| # | Formula | Misol | Manba |
|---|---|---|---|
| F24 | SETTL naqd: `g = so'm / LOM_kursi` | 1 800 000 / 900 000 = 2 g | `rpc_record_client_settlement` |
| F25 | SETTL dollar: `g = $ × USD_kursi / LOM_kursi` | 100 × 12 600 / 900 000 = 1.4 g | o'sha |
| F26 | SETTL jami: `lom585 + naqd_g + dollar_g`; ortig'i avans | 2.5641 + 2 + 1.4 = 5.9641 | o'sha |
| F27 | CPAY UZS: `kredit = so'm + $×USD + lom585×LOM` | 100 $ × 12 600 = 1 260 000 so'm | `rpc_record_client_currency_settlement` |
| F28 | CPAY USD: `kredit = $ + (so'm + lom585×LOM)/USD` | 1 260 000/12 600 = 100 $ | o'sha |
| F29 | Kurssiz F qismi *(088)*: `g = (UZS: summa; USD: summa×USD) / LOM` | 1 800 000 / 900 000 = 2 g majburiyatga | o'sha |
| F30 | Kursli F qismi: `g = to'langan × F.majburiyat_g / F.summa` (to'liq yopilsa — qolgan hammasi) | 4 300 000 × 10 / 8 600 000 = 5 g | o'sha |
| F31 | F snapshot (085): `UZS: summa / LOM`; `USD: summa × USD / LOM` | 8 600 000/860 000 = 10 g; 100×12 600/900 000 = 1.4 g | migration 085 |

## F. Kassa topshiruvi va havza

| # | Formula | Misol | Manba |
|---|---|---|---|
| F32 | Qiymatlangan qism: `min(topshirilgan, havza puli)`; `g = havza_g × qism / havza_puli` | havza 1 800 000 ↔ 2 g; 900 000 topshirildi → 1 g | `rpc_record_seller_to_manager_settlement` |
| F33 | Qiymatlanmagan: `so'm / LOM_kursi`; `$ × USD / LOM` | 950 000 / 950 000 = 1 g | o'sha |
| F34 | Kompaniya kurs farqi: `qiymatlangan_g − qiymatlangan_pul / farq_kursi` | 2 − 1 800 000/950 000 = 0.1053 g | o'sha (085 D-2) |
| F35 | Topshiruvning effektiv kursi: `so'm / naqd_g` | 1 800 000 / 2 = 900 000 | o'sha (`v_rate_applied`) |

## G. Seyf operatsiyalari

| # | Formula | Misol | Manba |
|---|---|---|---|
| F36 | Xarid: `jami = so'm + $×USD`; `1g = jami/vazn`; `585eq = vazn×proba/585` | 4 500 000 + 100×12 600 = 5 760 000; 5 g 750 → 6.4103 g | `rpc_record_gold_purchase` |
| F37 | Afinaj pateriyasi: `kirish585 − chiqish585`; `% = pateriya / kirish585 × 100` | 100 − 58×995/585 = 1.3504 g (1.350%) | `rpc_record_refining_batch` |
| F38 | Kapital/xarajat 585eq: so'm/LOM; $×USD/LOM; lom fizik×proba/585 | 900 000 so'm @900 000 = 1 g | `rpc_record_financial_transaction` |
| F39 | Sotuvchi LOM xaridi *(091)*: so'm −summa; lom fizik +g; 585eq + g×proba/585 | 2 g 750 → +2.5641 g | `rpc_record_seller_lom_purchase` |

## H. Vozvrat va bekor qilish

| # | Formula | Misol | Manba |
|---|---|---|---|
| F40 | Vozvrat qiymati: `client_due × qaytgan / savdo vazni` (oxirgisi — aniq qoldiq) | 22.4 × 6/20 = 6.72 g | `rpc_record_sale_return` |
| F41 | Qarz/avans: `qarz kamayishi = min(qiymat, max(net,0))`; qolgani avans | net 5 → qarz −5, avans +1.72 | o'sha |
| F42 | Savdo storno: `net = (qarz − avans) − client_due`; manfiy → avans | 7.2 − 11.2 = −4 → avans 4 | `rpc_reverse_client_sale` |
| F43 | Eski savdo vozvrati *(089)*: 585 → `g × (1 + ASL mijoz%)` | 5 g @20% → 6 g | `rpc_record_opening_sale_return` |

## I. Mijoz balansi va foyda

| # | Formula | Misol | Manba |
|---|---|---|---|
| F44 | `signedNet = qarz − avans`; jami `Σmax(0,net) − Σmax(0,−net)` | 12 va −3 → +9 | `customer-balance.ts` |
| F45 | Eski qarz qayta solishtirish: `Δ = maqsad − (qarz − avans)` (avans maqsadi: `−maqsad − net`) | 10 − 8 = +2 g | `rpc_record_client_legacy_debt` |
| F46 | Sof aktiv = aktivlar − majburiyatlar (585 g) | 1 300 − 220 = 1 080 | `rpc_get_accounting_profit_summary` |
| F47 | Davr natijasi = (joriy − baseline) − kapital kirimi + kapital chiqimi − eski qarz deltalari | (1080−1000) −30 +10 −5 = 55 g | o'sha |
| F48 | Fizik balans: `zavod kirimi = menejer + sotuvchilar + sotilgan + zavodga qaytgan` | 100 = 30 + 40 + 25 + 5 | `src/app/sales/app/page.tsx` |

## J. Cheklovlar (raqamli)

| # | Qoida | Manba |
|---|---|---|
| F49 | Mijoz foizi 0–100 | `ERR_MARKUP_OUT_OF_RANGE` |
| F50 | Kurs chegaralari (standart): LOM 100 000–3 000 000; USD 5 000–30 000; sotuvchi LOM rasmiydan ±25% | `_goldia_seller_rate_limits` (072) |
| F51 | Konsignatsiya donasi 0 < w ≤ 1000 g | `rpc_issue_barcode_consignment` |
| F52 | Eski qarz takrori: 10 daqiqa ichida bir xil qo'shimcha rad | `rpc_record_client_legacy_debt` |
| F53 | Boshlang'ich T0: kelajakda emas, ≤ 24 soat eski, freeze'dan ≤ 1 soat oldin | 086 test F4 |
