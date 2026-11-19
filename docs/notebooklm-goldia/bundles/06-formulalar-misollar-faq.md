# Goldia Sales — 6-to'plam: Formulalar, end-to-end misollar, 120 savol-javob
> Ushbu to'plam quyidagi fayllarni birlashtiradi: 11-business-formulas.md, 16-end-to-end-business-examples.md, 12-faq-troubleshooting.md. Tekshirilgan kod: commit `052ad17`, schema `20260101000091`; production 088 (NOT VERIFIED). Sana: 2026-11-19. Barcha misollar sintetik.


---

<!-- manba fayl: 11-business-formulas.md -->

## 11. Biznes formulalari (har biri sonli misol bilan)

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19. Misollar sintetik.
> Yaxlitlash: grammlar 4 xona (`numeric(14,4)`, `round(...,4)`), pul 2 xona; havza grammlari 6 xona.

### A. Proba va oltin

| # | Formula | Misol | Manba |
|---|---|---|---|
| F1 | `585eq = fizik × proba / 585` | 10 g 750 → 12.8205 g | `rpc_record_client_settlement` |
| F2 | `sof (fine) = fizik × proba / 1000` | 10 g 750 → 7.5 g | o'sha |
| F3 | Lom probasi ruxsati: 300 ≤ proba ≤ 1000 | 250 → rad | o'sha |
| F4 | Toza oltin 585eq: `fizik × proba / 585` | 20 g 999 → 34.1538 g; sof 19.98 g | test 085 D-6 |

### B. Zavod

| # | Formula | Misol | Manba |
|---|---|---|---|
| F5 | `zavod majburiyati = kirim fizik × (1 + zavod%/100)` | 100 g @8% → 108 g | `rpc_record_factory_receipt` |
| F6 | `zavod neti = Σmajburiyat − Σtopshirilgan`; ≥0 qarz, <0 avans | 108 − 120 → avans 12 g | o'sha / `_goldia_vault_factory_add` |
| F7 | `topshiruv 585eq = fizik × proba / 585` | 10 g 999 → 17.0769 g | `rpc_record_factory_gold_handover` |
| F8 | Kartalar: `tovar qarzi + C − (C2 + topshiruvlar) = seyf neti` | 108 + 0 − (50 + 17.0769) = 40.9231 | `factory-account-summary.ts` |
| F9 | Zavodga tovar qaytarish *(090)*: `qiymat = g × (1 + kirim%)` | 10 g @8% → 10.8 g | `rpc_return_goods_to_factory` |
| F10 | factory_settled *(088)*: B o'z kirimi → `g × (1 + kirim%)`; A'dan olingan B → `g × (1 + A%)` | 50 g, A 8% → 54 g zavod hisobidan ayriladi | migration 088 |

### C. Konsignatsiya va sotuvchi

| # | Formula | Misol | Manba |
|---|---|---|---|
| F11 | `sotuvchi majburiyati = bazaviy × (1 + sotuvchi%/100)` | 15 g @12% → 16.8 g | `rpc_issue_barcode_consignment` |
| F12 | `konsignatsiya zavod qismi = bazaviy × (1 + zavod%/100)` (ma'lumot) | 15 g @8% → 16.2 g | o'sha |
| F13 | Bozor qarzi: `majburiyat = Σkonsignatsiya + max(0,Σeski qarz) + boshlang'ich`; `owes = max(0, majburiyat − Σtopshiruv)` | 16.8 + 5 − 20 = 1.8 g | `recalc_seller_gold_account` |
| F14 | `bozor_qarzi_signed = manager_owes − seller_owes` | sotuvchi 1.8 qarz → −1.8 | o'sha |
| F15 | Sotuvchi ombori: `Σkonsignatsiya bazaviy − Σsavdo vazni + Σvozvrat` | 15 − 10 + 2 = 7 g | `get_seller_available_stock_grams` |
| F16 | Donani qaytarish: `majburiyat −= w × (1 + s%)` | 5 g @12% → −5.6 g | `rpc_return_piece_to_manager` |

### D. Savdo

| # | Formula | Misol | Manba |
|---|---|---|---|
| F17 | Vazn savdosi: `qarz = vazn × (1 + mijoz%/100)` | 10 g @12% → 11.2 g | `rpc_record_weight_sale` |
| F18 | Avans ishlatish: `ishlatilgan = min(avans, qarz)`; `yangi qarz = qarz − ishlatilgan` | qarz 11.2, avans 2 → +9.2 | o'sha |
| F19 | Dona savdosi: `factory_due = w × (1+zavod%)`; `qarz = w × (1+mijoz%)`; `spread = qarz − factory_due` | 5 g, 8%/15% → 5.4 / 5.75 / 0.35 | `rpc_record_barcode_piece_sale` |
| F20 | Vazn savdosida `markup_spread = qarz − vazn` | 11.2 − 10 = 1.2 g | `rpc_record_weight_sale` |
| F21 | Ustama farqi: `farq = vazn × (mijoz% − tayinlangan s%) / 100` | 100 g, 12% vs 15% → −3 g | trigger `trg_goldia_sale_markup_snapshot` |
| F22 | Valyuta savdosi: qarz = summa (valyutada), avans shu valyutadan | 2000 $ − 300 $ avans → 1700 $ | `rpc_record_currency_sale` |
| F23 | Partiya savdosi: `qarz = partiya bazaviy × (1+mijoz%)` | 15 g @15% → 17.25 g | `rpc_record_client_jewelry_sale` |

### E. To'lovlar

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

### F. Kassa topshiruvi va havza

| # | Formula | Misol | Manba |
|---|---|---|---|
| F32 | Qiymatlangan qism: `min(topshirilgan, havza puli)`; `g = havza_g × qism / havza_puli` | havza 1 800 000 ↔ 2 g; 900 000 topshirildi → 1 g | `rpc_record_seller_to_manager_settlement` |
| F33 | Qiymatlanmagan: `so'm / LOM_kursi`; `$ × USD / LOM` | 950 000 / 950 000 = 1 g | o'sha |
| F34 | Kompaniya kurs farqi: `qiymatlangan_g − qiymatlangan_pul / farq_kursi` | 2 − 1 800 000/950 000 = 0.1053 g | o'sha (085 D-2) |
| F35 | Topshiruvning effektiv kursi: `so'm / naqd_g` | 1 800 000 / 2 = 900 000 | o'sha (`v_rate_applied`) |

### G. Seyf operatsiyalari

| # | Formula | Misol | Manba |
|---|---|---|---|
| F36 | Xarid: `jami = so'm + $×USD`; `1g = jami/vazn`; `585eq = vazn×proba/585` | 4 500 000 + 100×12 600 = 5 760 000; 5 g 750 → 6.4103 g | `rpc_record_gold_purchase` |
| F37 | Afinaj pateriyasi: `kirish585 − chiqish585`; `% = pateriya / kirish585 × 100` | 100 − 58×995/585 = 1.3504 g (1.350%) | `rpc_record_refining_batch` |
| F38 | Kapital/xarajat 585eq: so'm/LOM; $×USD/LOM; lom fizik×proba/585 | 900 000 so'm @900 000 = 1 g | `rpc_record_financial_transaction` |
| F39 | Sotuvchi LOM xaridi *(091)*: so'm −summa; lom fizik +g; 585eq + g×proba/585 | 2 g 750 → +2.5641 g | `rpc_record_seller_lom_purchase` |

### H. Vozvrat va bekor qilish

| # | Formula | Misol | Manba |
|---|---|---|---|
| F40 | Vozvrat qiymati: `client_due × qaytgan / savdo vazni` (oxirgisi — aniq qoldiq) | 22.4 × 6/20 = 6.72 g | `rpc_record_sale_return` |
| F41 | Qarz/avans: `qarz kamayishi = min(qiymat, max(net,0))`; qolgani avans | net 5 → qarz −5, avans +1.72 | o'sha |
| F42 | Savdo storno: `net = (qarz − avans) − client_due`; manfiy → avans | 7.2 − 11.2 = −4 → avans 4 | `rpc_reverse_client_sale` |
| F43 | Eski savdo vozvrati *(089)*: 585 → `g × (1 + ASL mijoz%)` | 5 g @20% → 6 g | `rpc_record_opening_sale_return` |

### I. Mijoz balansi va foyda

| # | Formula | Misol | Manba |
|---|---|---|---|
| F44 | `signedNet = qarz − avans`; jami `Σmax(0,net) − Σmax(0,−net)` | 12 va −3 → +9 | `customer-balance.ts` |
| F45 | Eski qarz qayta solishtirish: `Δ = maqsad − (qarz − avans)` (avans maqsadi: `−maqsad − net`) | 10 − 8 = +2 g | `rpc_record_client_legacy_debt` |
| F46 | Sof aktiv = aktivlar − majburiyatlar (585 g) | 1 300 − 220 = 1 080 | `rpc_get_accounting_profit_summary` |
| F47 | Davr natijasi = (joriy − baseline) − kapital kirimi + kapital chiqimi − eski qarz deltalari | (1080−1000) −30 +10 −5 = 55 g | o'sha |
| F48 | Fizik balans: `zavod kirimi = menejer + sotuvchilar + sotilgan + zavodga qaytgan` | 100 = 30 + 40 + 25 + 5 | `src/app/sales/app/page.tsx` |

### J. Cheklovlar (raqamli)

| # | Qoida | Manba |
|---|---|---|
| F49 | Mijoz foizi 0–100 | `ERR_MARKUP_OUT_OF_RANGE` |
| F50 | Kurs chegaralari (standart): LOM 100 000–3 000 000; USD 5 000–30 000; sotuvchi LOM rasmiydan ±25% | `_goldia_seller_rate_limits` (072) |
| F51 | Konsignatsiya donasi 0 < w ≤ 1000 g | `rpc_issue_barcode_consignment` |
| F52 | Eski qarz takrori: 10 daqiqa ichida bir xil qo'shimcha rad | `rpc_record_client_legacy_debt` |
| F53 | Boshlang'ich T0: kelajakda emas, ≤ 24 soat eski, freeze'dan ≤ 1 soat oldin | 086 test F4 |


---

<!-- manba fayl: 16-end-to-end-business-examples.md -->

## 16. End-to-end biznes misollari (sintetik)

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (NOT VERIFIED). Sana: 2026-11-19.
> Barcha ism va raqamlar **sintetik**. Ishtirokchilar: menejer **M**, sotuvchi **S**, mijozlar **K1, K2, K3**. Yaxlitlash 4 xona (server kabi).

### Misol 1. To'liq zanjir: zavod → sotuvchi → mijoz → kassa → afinaj → zavod

Kurslar: LOM 900 000 so'm/g (to'lov kuni), 950 000 (topshiruv kuni); USD 12 600 (to'lov), 12 700 (topshiruv).

| Qadam | Amal (RPC) | Hisob-kitob |
|---|---|---|
| 1 | Zavoddan kirim 100 g @8% (`rpc_record_factory_receipt`) | zavod qarzi = 100 × 1.08 = **108 g**; menejer ombori 100 g |
| 2 | S ga 10 dona × 4 g = 40 g, zavod 8%, sotuvchi 12% (`rpc_issue_barcode_consignment`) | menejer ombori 60; S ombori 40; S majburiyati = 40 × 1.12 = **44.8 g**; zavod qarzi o'zgarmaydi |
| 3 | K1 ga vazn savdosi 10 g @15% (`rpc_record_weight_sale`) | K1 qarzi = 10 × 1.15 = **11.5 g**; S ombori 30; majburiyat 44.8 (o'zgarmaydi) |
| 4 | K1 to'laydi (SETTL): 3 g 585 lom + 4 500 000 so'm + 100 $ | lom 3 g; so'm 4 500 000/900 000 = 5 g; $ 100×12 600/900 000 = 1.4 g; jami **9.4 g** → K1 qarzi 2.1 g. S kassasi: lom 3 g, 4 500 000 so'm, 100 $; havza: so'm↔5 g, $↔1.4 g |
| 5 | M S kassasini to'liq qabul qiladi, LOM 950 000, USD 12 700 (`rpc_record_seller_to_manager_settlement`) | yopiladi 3 + 5 + 1.4 = **9.4 g** (havza grammlari); S majburiyati 44.8 − 9.4 = **35.4 g**; kompaniya kurs farqi: so'm 5 − 4 500 000/950 000 = 0.2632; $ 1.4 − 100×12 700/950 000 = 0.0632; jami **0.3264 g**; seyf: lom +3, so'm +4 500 000, $ +100 |
| 6 | Afinaj: 3 g 585 lom → 1.74 g 995 (`rpc_record_refining_batch`) | chiqish = 1.74 × 995/585 = 2.9595 g; pateriya = 3 − 2.9595 = **0.0405 g (1.35%)**; seyf lom 0, toza oltin +2.9595 |
| 7 | Zavodga toza oltin 1.74 g @995 (`rpc_record_factory_gold_handover`, refined_gold) | 585eq 2.9595 → zavod qarzi 108 − 2.9595 = **105.0405 g** |

**Yakuniy holat:**
| Hisob | Qiymat |
|---|---|
| Zavod qarzi | 105.0405 g |
| Menejer ombori | 60 g |
| S ombori | 30 g |
| S majburiyati (Bozor qarzi) | 35.4 g (signed −35.4) |
| S kassasi | 0 |
| Menejer seyfi | 4 500 000 so'm, 100 $, lom 0, toza oltin 0 |
| K1 qarzi | 2.1 g |
| Fizik balans | kirim 100 = menejer 60 + S 30 + sotilgan 10 ✔ |

### Misol 2. Dollar narxidagi savdo va aralash CPAY

| Qadam | Amal | Hisob |
|---|---|---|
| 1 | S K2 ga 5 g ni **600 $** ga sotadi (`rpc_record_currency_sale`) | S ombori 30 → 25; K2 USD qarzi 600 $; 585 qarzi o'zgarmaydi; S majburiyati 35.4 o'zgarmaydi |
| 2 | K2 CPAY (USD qarz): 300 $ + 2 540 000 so'm, USD 12 700 | kredit = 300 + 2 540 000/12 700 = 300 + 200 = **500 $** → qarz 100 $. S kassasi +300 $, +2 540 000 so'm (qiymatlanmagan) |
| 3 | M kassani qabul qiladi, LOM 950 000, USD 12 700 | so'm 2 540 000/950 000 = 2.6737 g; $ 300×12 700/950 000 = 4.0105 g; jami **6.6842 g** → S majburiyati 35.4 − 6.6842 = **28.7158 g** |

### Misol 3. Qisman to'langan savdoni bekor qilish

| Qadam | Hisob |
|---|---|
| K3 ga 10 g @12% | qarz 11.2 g |
| K3 4 g 585 lom bilan to'laydi | qarz 7.2 g; S kassasi lom +4 g |
| Savdo bekor qilinadi (`rpc_reverse_client_sale`, sabab "noto'g'ri mijoz") | net = 7.2 − 0 − 11.2 = −4 → qarz 0, **avans 4 g**; S ombori +10 g; S majburiyati o'zgarmaydi; kassa (4 g lom) qoladi |

### Misol 4. Ikki bosqichli vozvrat

Savdo 20 g @12% = 22.4 g. Mijoz 17.4 g to'lagan (qarz 5 g).

| Vozvrat | Qiymat | Qarz | Avans | Sotuvchi ombori |
|---|---|---|---|---|
| V1: 6 g sotuvchi javoniga | 22.4 × 6/20 = **6.72** | 5 → 0 | +1.72 | +6 |
| V2: qolgan 14 g (oxirgi) | qoldiq = 22.4 − 6.72 = **15.68** | 0 | 1.72 + 15.68 = **17.4** | +14 |

Tekshiruv: jami avans 17.4 = mijoz to'lagan summa ✔; vozvratlar yig'indisi = savdo qiymati 22.4 ✔ (oxirgi vozvrat aniq qoldiqni oladi). Sotuvchi majburiyati o'zgarmaydi (tovar sotuvchida).

### Misol 5. Konsignatsiya reversali: production (088) va 090 farqi

Kirimlar: R1 da 10 g, R2 da 20 g qolgan. Konsignatsiya 15 g (4+5+6), FIFO: R1 dan 10, R2 dan 5. Sotuvchi 12% → majburiyat 16.8 g. Hech narsa sotilmagan.

| | Production 088 (039-mantiq) | 090 (deploy qilinmagan) |
|---|---|---|
| Qaytish | 15 g hammasi bitta saqlangan kirimga (R1) — R1 bergan 10 g dan oshadi | R1 +10, R2 +5 (`consignment_receipt_allocations` bo'yicha) |
| Sotuvchi | ombor −15, majburiyat −16.8 | ombor −15, majburiyat −16.8, `recalc` chaqiriladi |
| Davriy hisobot | ikki marta sanash xatosi bo'lishi mumkin | bir marta |
Manba: `RELEASE-090-REPORT.md` §1b.

### Misol 6. Kursli boshlang'ich so'm qarzi (F) — to'lov va topshiruv (test 085 D-2)

| Qadam | Hisob |
|---|---|
| T0: F hujjat 8 600 000 so'm @ 860 000 | sotuvchi majburiyati +**10 g** (bir marta) |
| Mijoz 8 600 000 so'm to'laydi (CPAY) | mijoz so'm qarzi 0; havzaga 8 600 000 ↔ 10 g |
| Topshiruv 900 000 kursida | majburiyat −**10 g** (aniq); kompaniya kurs farqi 10 − 8 600 000/900 000 = **0.4444 g** |

### Misol 7. Kurssiz boshlang'ich so'm qarzi (088)

| Qadam | Hisob |
|---|---|
| T0: F hujjat 4 500 000 so'm, kurssiz | "Hali hisoblanmagan"; sotuvchi majburiyati 0 |
| To'lov 1 800 000 so'm, LOM 900 000 | shu qism baholanadi: 1 800 000/900 000 = **2 g** → majburiyat +2 g; havzaga 1 800 000 ↔ 2 g; qolgan F 2 700 000 (kurssiz) |
| Topshiruv | 2 g yopiladi → sof ta'sir 0 |
| Keyingi to'lov 2 700 000, LOM 950 000 | 2 700 000/950 000 = 2.8421 g baholanadi |

### Misol 8. To'lovni bekor qilish tartibi (topshiruvdan keyin)

| Qadam | Natija |
|---|---|
| SETTL 900 000 so'm @900 000 (1 g) | mijoz qarzi −1 g; kassa +900 000 |
| Topshiruv (900 000) | majburiyat −1 g; kassa 0; seyf +900 000 |
| SETTL'ni bekor qilish | **Rad**: "Sotuvchi kassasidagi naqd so'm yetarli emas" |
| Avval topshiruvni bekor qilish | seyf −900 000; kassa +900 000; majburiyat +1 g |
| Endi SETTL'ni bekor qilish | mijoz qarzi +1 g; kassa 0 |

### Misol 9. Davr foydasi

Baseline sof aktiv: **1 000 g**. Hozir: aktivlar 1 300 g (ombor 500 + mijoz qarzlari 400 + kassa 585eq 300 + lom 100), majburiyatlar 220 g (zavod qarzi 200 + mijoz avanslari 20) → sof aktiv **1 080 g**.
Davrda: kapital kirimi 30 g, foyda taqsimoti 10 g, baseline'dan keyingi eski qarz deltalari +5 g, xarajat 12 g (sof aktivni allaqachon kamaytirgan).
**Natija** = (1080 − 1000) − 30 + 10 − 5 = **55 g** (xarajat qayta qo'shilmaydi). Manba: `rpc_get_accounting_profit_summary`.

### Misol 10. Ustama farqi

Sotuvchiga 12% bilan berilgan 20 g. Sotuvchi K1 ga 10 g ni 15% bilan, K2 ga 10 g ni 10% bilan sotdi.
- K1: 10 × (15 − 12)/100 = **+0.3 g**; K2: 10 × (10 − 12)/100 = **−0.2 g**; jami **+0.1 g** (kompaniyaniki).
- Sotuvchi majburiyati 22.4 g o'zgarmaydi; K1 qarzi 11.5 g, K2 qarzi 11 g.


---

<!-- manba fayl: 12-faq-troubleshooting.md -->

## 12. Savol-javoblar (FAQ) va muammolarni hal qilish

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19. Misollar sintetik.
> Har javob oxirida manba ko'rsatilgan. **[089]/[090]/[091]** — production'da hali yo'q funksiya.

### A. Umumiy (1–12)

**1. Goldia Sales nimani hisoblaydi?** — Zavod → menejer → sotuvchi → mijoz zanjiridagi tovar, qarz va kassalarni 585 gramm, so'm va dollarda alohida. *Manba: `src/app/sales/app/page.tsx`, `customer-balance.ts`.*

**2. Nega hamma narsa 585 grammda?** — Asosiy birlik 585 proba; boshqa proba `fizik × proba / 585` bilan keltiriladi. *`rpc_record_client_settlement`.*

**3. So'm va 585 gramm qo'shib ko'rsatiladimi?** — Yo'q, "585 gram, UZS and USD are NEVER added together". Faqat foyda hisobida kurs bilan 585 ga aylantiriladi. *`customer-balance.ts`, `rpc_get_accounting_profit_summary`.*

**4. Production hozir qaysi versiyada?** — Release hisobotlari bo'yicha migration 088; 089, 090, 091 deploy qilinmagan. To'g'ridan-to'g'ri tekshirilmagan (NOT VERIFIED). *`RELEASE-091-REPORT.md`.*

**5. Sana qaysi vaqt zonasida?** — Toshkent (`Asia/Tashkent`); biznes sana `_goldia_business_date`. *Migration 073, `business-date.ts`.*

**6. Internet uzilsa nima bo'ladi?** — Qizil chiziq: "Internet aloqasi yo'q! ... yozish amallari faqat onlayn rejimda ishlaydi." Offline yozuv yo'q. *`layout.tsx`.*

**7. Bir tugmani ikki marta bossam ikki marta yoziladimi?** — Yo'q, deyarli barcha yozish RPC'lari idempotentlik kaliti bilan himoyalangan; takror so'rov birinchi natijani qaytaradi. *`check_and_lock_idempotency` (016).*

**8. Hujjat o'chiriladimi?** — Yo'q; bekor qilinadi (`reversed`) va audit qoladi. *Barcha `rpc_reverse_*`.*

**9. "STAGING DEMO" chizig'i nima?** — Test muhiti; real production emas. *`layout.tsx`.*

**10. Qanday hujjat raqamlari bor?** — ZVD, CONS-BC, SALE-W/BC/UZS/USD, SETTL, CPAY, STL-MGR, HND, BUY, REF, FTX, OPD. *`01-overview.md` §6.*

**11. Menejer va direktor huquqi farq qiladimi?** — Goldia Sales'da bir xil (077 qarori); faqat moliyaviy restart direktorniki. *`sales-role-access.ts`, `rpc_financial_restart`.*

**12. Boshqa tashkilot ma'lumotini ko'ra olamanmi?** — Yo'q, tashkilot izolyatsiyasi RLS va RPC ichida. *`multi-tenant-security.test.ts`.*

### B. Rollar va kirish (13–20)

**13. Sotuvchi qaysi sahifalarni ko'radi?** — Asosiy Panel, Skaner Savdo, Mijozlar va Nasiya, Kassam, Ustama Farqi. *`SELLER_NAVIGATION`.*

**14. Sotuvchi menejer sahifasini URL orqali ochsa?** — `/sales/app?unauthorized=1` ga qaytadi; database ham rad etadi. *`layout.tsx`, `isRouteAllowedForSeller`.*

**15. Sotuvchi LOM kursini o'zgartira oladimi?** — Rasmiy kursni yo'q ("⚙️ Kurs" ko'rinmaydi); o'z kurslarini "Mening kurslarim"da belgilaydi. *`rpc_set_my_seller_rates` (072).*

**16. Menejer sotuvchi kursini o'zgartira oladimi?** — Yo'q, "kursni faqat sotuvchi o'zi uchun belgilaydi"; menejer faqat ko'radi va operatsiyada boshqa kurs kirita oladi. *072, 084.*

**17. Buxgalter nimalar qila oladi?** — Ayrim RPC'lar ruxsat beradi: SETTL, zavod kirimi, zavodga topshirish, xarid, kunlik kurs, eski qarzni bekor qilish; menyuda "Moliyaviy Hisobotlar". *RPC rol ro'yxatlari.*

**18. Kim moliyaviy hisobni qayta boshlay oladi?** — Faqat direktor. *`rpc_financial_restart`.*

**19. Sotuvchi o'z mijozini boshqa sotuvchiga o'tkaza oladimi?** — Yo'q. *`_goldia_guard_customer_assignment` (079).*

**20. "Permission denied: no active employee profile" nima?** — Foydalanuvchining faol `employees` yozuvi yo'q yoki nofaol. Admin xodim profilini faollashtirishi kerak. *`assert_erp_permission`.*

### C. Savdo (21–38)

**21. Vazn bo'yicha savdo qanday hisoblanadi?** — `qarz = vazn × (1 + mijoz%)`; 10 g @12% = 11.2 g. *`rpc_record_weight_sale`.*

**22. Mijoz foizi standart qancha?** — Formada 12.0 ("Standart: 12.0% yoki 15.0%"); server foizni majburiy talab qiladi, yashirin standart yo'q. *`CustomerLedgerAndSheetsSection.tsx`, `ERR_MARKUP_REQUIRED`.*

**23. Foiz 100% dan ko'p bo'lishi mumkinmi?** — Yo'q, 0–100. *`ERR_MARKUP_OUT_OF_RANGE`.*

**24. Vazn savdosida donani tanlash shartmi?** — Yo'q (076); tanlanmasa eng eski donalardan olinadi, faqat oxirgisi kesiladi. *`_goldia_consume_weight_sale_pieces`.*

**25. `ERR_PIECE_EXTRA` nima?** — Tanlangan donalardan oxirgisi kerak emas edi (oldingilari vaznni qoplaydi). *`rpc_record_weight_sale`.*

**26. `ERR_INSUFFICIENT_SELLER_STOCK` chiqdi.** — Sotuvchi omborida yetarli gramm yo'q; menejer avval tovar tarqatsin. *O'sha.*

**27. Savdo sotuvchi majburiyatini o'zgartiradimi?** — Yo'q; majburiyat konsignatsiyada yaratilgan, savdo faqat omborni kamaytiradi. *`recalc_seller_gold_account`, 085 hisobot.*

**28. Mijozda avans bo'lsa savdo qanday yoziladi?** — Avans avtomatik ishlatiladi: `min(avans, qarz)`. *`rpc_record_weight_sale`.*

**29. Dona savdosida qarz qanday?** — `w × (1 + mijoz%)`; 5 g @15% = 5.75 g. *`rpc_record_barcode_piece_sale`.*

**30. Dollar narxida sotish mumkinmi?** — Ha, "Aniq USD" (yoki "Aniq UZS"); qarz valyutada yoziladi, 585 qarz o'zgarmaydi. *`rpc_record_currency_sale` (077).*

**31. Valyuta savdosi omborni kamaytiradimi?** — Ha, vazn bo'yicha. *O'sha.*

**32. Valyuta savdosida ustama farqi hisoblanadimi?** — Yo'q (`markup_difference_g = NULL`). *`trg_goldia_sale_markup_snapshot`.*

**33. Arxivlangan mijozga sotsa bo'ladimi?** — Yo'q, `ERR_CUSTOMER_ARCHIVED`; avval tiklang. *079.*

**34. Sotuvchi boshqa sotuvchining mijoziga sota oladimi?** — Yo'q; biriktirilmagan mijozga mumkin (mijoz avtomatik biriktirilmaydi). *076, 079.*

**35. Butun partiyani bir mijozga sotish?** — Sotuvchi mobil "🏷️ Nasiya" — faqat tegilmagan partiya; aks holda `ERR_CONSIGNMENT_PARTIALLY_USED`. *`rpc_record_client_jewelry_sale`.*

**36. Savdo chekini qayta chop etish?** — Chek savdodan keyin ochiladi ("🖨️ Chop etish", "📋 Nusxa olish"). Keyinchalik qayta ochish yo'li `/sales/app` ichida tekshirilmagan — NOT VERIFIED. *`SalesReceiptModal.tsx`.*

**37. Savdo sanasini o'zgartirish mumkinmi?** — Savdo sanasi server biznes sanasi (bugun). [090] tahrirlashda yangi savdo bugungi sana bilan yoziladi. *`rpc_record_weight_sale`, `rpc_edit_client_sale`.*

**38. Mijozga sotuvchi biriktirilmagan bo'lsa?** — Mijozlar sahifasidagi savdo formasi rad etadi: "Mijozga sotuvchi biriktirilmagan. Avval mijozni sotuvchiga biriktiring." *`CustomerLedgerAndSheetsSection.tsx`.*

### D. Mijoz qarzi va avans (39–52)

**39. Mijoz qarzi manfiy ko'rinyapti.** — Manfiy = avans, biz mijozga qarzdormiz. *`customer-balance.ts`.*

**40. "Mijozlar sof qarzi" qanday hisoblanadi?** — Σ ochiq qarz − Σ ochiq avans, har birlik alohida. *`ManagerSimplePanel`.*

**41. Mijoz avansi sotuvchi majburiyatiga ta'sir qiladimi?** — Yo'q. *`customer-balance.ts` izohi.*

**42. Ortiqcha to'lov nima bo'ladi?** — Avansga o'tadi va keyingi savdoda ishlatiladi. *`rpc_record_client_settlement`.*

**43. Eski daftardagi qarzni qanday kiritaman?** — "📋 Eski qarz" → qayta solishtirish yoki to'g'ridan-to'g'ri → sana va daftar izohi majburiy. *`rpc_record_client_legacy_debt`.*

**44. Sotuvchi eski qarzni kamaytira oladimi?** — Yo'q, faqat qo'shadi; kamaytirish — menejer/direktor. *076.*

**45. Sotuvchi avans kirita oladimi?** — Ha (081), faqat qarzi yo'q o'z mijoziga va faqat qo'shish sifatida. *081.*

**46. Eski qarz sotuvchi majburiyatini oshiradimi?** — Ha, qarz turidagi eski qarz yozuvlari majburiyatga 1:1 qo'shiladi (manfiy bo'lmaydi). *`recalc_seller_gold_account`, test 076.*

**47. "Takroriy so'rov: ... 10 daqiqa ichida kiritilgan" xatosi?** — Bir xil eski qarz 10 daqiqa ichida qayta yuborilgan; ikki marta qo'shilmagan. *081.*

**48. Mijozni o'chirsam qarz yo'qoladimi?** — Yo'q; arxivda qarz qoladi, to'lov qabul qilinadi. *078 SEC-3.*

**49. Arxivdan qanday qaytaraman?** — "🗄️ Arxivlangan mijozlar" → "♻️ Tiklash". *`rpc_archive_customer`.*

**50. Mijoz kodi qanday beriladi?** — Tashkilot ichida avtomatik (CUST-0001...), 9999 dan katta raqamlar kesilmaydi. *075.*

**51. Bir xil ismli mijoz ikki marta yaratiladimi?** — Bir tashkilotda bir xil ism — mavjud mijoz qaytariladi. *Test 075.*

**52. Oylik hisobotda "Boshlang'ich / Eski Qarz" nima?** — Oy boshidagi qoldiq va eski qarz yozuvlari. *`rpc_get_customer_monthly_report`.*

### E. To'lovlar, valyuta, LOM (53–75)

**53. SETTL va CPAY farqi?** — SETTL 585 gramm qarzni, CPAY so'm/dollar qarzni yopadi. *`payment-hints.ts`.*

**54. Mijoz 585 qarzini so'mda to'lasa?** — SETTL: `so'm / LOM kursi` gramm yopiladi. 1 800 000 / 900 000 = 2 g. *`rpc_record_client_settlement`.*

**55. Dollar bilan 585 qarz to'lansa?** — `$ × USD kursi / LOM kursi`; 100 × 12 600 / 900 000 = 1.4 g. *O'sha.*

**56. Lom bilan to'lansa?** — `fizik × proba / 585`; 10 g 750 = 12.8205 g. *O'sha.*

**57. Lom probasi qanday chegarada?** — 300–1000. *O'sha.*

**58. `ERR_DAILY_RATE_NOT_SET`?** — Naqd/dollar uchun 585 kurs yo'q; kunlik kursni kiriting yoki operatsiyada kurs bering. *O'sha.*

**59. `ERR_RATE_REQUIRED: Dollar (USD) to'lovi uchun USD kursini kiriting`?** — USD kursi kiritilmagan; tizim taxminiy kurs ishlatmaydi. *084.*

**60. `ERR_RATE_OUT_OF_RANGE`?** — Kurs chegaradan tashqarida (standart LOM 100 000–3 000 000, USD 5 000–30 000) yoki sotuvchi LOM kursi rasmiydan 25% dan ko'p farq qiladi. *072.*

**61. So'm qarzni dollar bilan to'lash?** — CPAY UZS: `kredit = $ × USD kursi`; 100 × 12 600 = 1 260 000 so'm; kassaga dollar tushadi. *CPAY.*

**62. Dollar qarzni so'm bilan to'lash?** — CPAY USD: `kredit = so'm / USD kursi`. *CPAY.*

**63. Nega "so'mga aylantirmang" deb yozilgan?** — Dollar so'mga aylantirib kiritilsa kassada noto'g'ri valyuta bo'ladi; tizim dollar maydonini alohida talab qiladi va butun dollar so'm summasida ogohlantiradi. *P1 UI `3d87193`, `payment-hints.ts`.*

**64. Noto'g'ri valyutada kiritilgan to'lovni qanday tuzataman?** — Production'da: to'lovni bekor qilib qayta kiritish. [089]: "💱 Valyutani tuzatish" bitta amalda. *`rpc_correct_client_payment`.*

**65. To'lov sotuvchi majburiyatini kamaytiradimi?** — Yo'q; faqat menejerga topshiruv kamaytiradi. *`recalc_seller_gold_account`.*

**66. "Qiymatlangan pul havzasi" nima?** — 072'dan beri SETTL bilan olingan pul to'lov paytidagi gramm qiymatini saqlaydi; topshiruvda aynan shu gramm yopiladi. *`trg_goldia_seller_till_pool`.*

**67. Topshiruv kuni kurs o'zgarsa sotuvchi zarar ko'radimi?** — Yo'q; qiymatlangan pul to'lov grammini yopadi, farq kompaniya kurs farqi sifatida yoziladi. *085 D-2.*

**68. Valyuta savdosidan kelgan pul qanday topshiriladi?** — Qiymatlanmagan; topshiruv kursida grammga aylantiriladi (maydon: "LOM / 585 kursi (UZS/g) — faqat qiymatlanmagan pul uchun:"). *`rpc_record_seller_to_manager_settlement`.*

**69. Sotuvchi kassadagidan ko'p topshira oladimi?** — Yo'q: `ERR_INSUFFICIENT_SCRAP_BALANCE` / `CASH` / `USD`. *O'sha.*

**70. Topshiruvni kim yozadi?** — UI'da menejer qabul qiladi; database sotuvchiga faqat o'z kassasini ruxsat beradi. *`kassam/page.tsx`, RPC.*

**71. Kurs operatsiyadan keyin o'zgarsa eski hujjat qayta hisoblanadimi?** — Yo'q, kurs hujjatda snapshot. *084.*

**72. Kurssiz boshlang'ich so'm qarzi qanday baholanadi?** — Har to'lov o'z kursida, faqat boshlang'ich qarzga tushgan qismi. *088.*

**73. `ERR_OPENING_DEBT_OTHER_SELLER`?** — Mijozning boshlang'ich qarzi boshqa sotuvchi majburiyatida; to'lov o'sha sotuvchi kassasiga qabul qilinadi. *088.*

**74. Sotuvchi bozordan lom sotib ola oladimi?** — [091] Ha, kassadagi so'mdan; production'da hali yo'q. *`rpc_record_seller_lom_purchase`.*

**75. Kassa sanog'i nima uchun?** — [089] Haqiqiy pulni qayd etish (shaxsiy ishlatilgan / yetishmovchilik); balans o'zgarmaydi. *`rpc_record_seller_till_count`.*

### F. Ombor va konsignatsiya (76–86)

**76. Sotuvchiga tovar qanday beriladi?** — Scanner 564 Tarqatish: sotuvchi, foizlar, skaner, tasdiqlash. *`rpc_issue_barcode_consignment`.*

**77. Sotuvchi majburiyati qanday hisoblanadi?** — `bazaviy × (1 + sotuvchi%)`; 15 g @12% = 16.8 g. *O'sha.*

**78. Standart foizlar?** — Zavod 8%, sotuvchi 12% (UI). *`ScannerConsignmentSection.tsx`.*

**79. Tarqatish zavod qarzini o'zgartiradimi?** — Yo'q. *Test 085 D1-3.*

**80. FIFO nima?** — Kirim tanlanmasa eng eski kirimdan boshlab olinadi. *`rpc_issue_barcode_consignment`.*

**81. Sotuvchi donani qaytara oladimi?** — Ha, sotilmagan o'z donasini; majburiyat `w × (1+s%)` ga kamayadi. *`rpc_return_piece_to_manager`.*

**82. Konsignatsiyani bekor qilish mumkinmi?** — Ha, management, sotilgan donasi bo'lmasa. 090'da kirim taqsimoti bo'yicha aniq qaytariladi. *`rpc_reverse_barcode_consignment`.*

**83. Menejer ombori qanday hisoblanadi?** — Faol kirimlar `available_physical_g` + kirimsiz konsignatsiyadan qaytgan donalar. *`get_manager_available_stock_grams`.*

**84. Boshqa probadagi tovar kirim qilinadimi?** — Yo'q, faqat 585. *`rpc_record_factory_receipt`.*

**85. Donalar soni va grammi mosligini qayerda ko'raman?** — [089] "Ombor harakati" sahifasi; production'da Boshqaruvchi Ombori sahifasi. *`rpc_get_seller_stock_movements`.*

**86. Dona vazni chegarasi?** — 0 < w ≤ 1000 g. *`rpc_issue_barcode_consignment`.*

### G. Zavod, seyf, afinaj (87–97)

**87. Zavod qarzi qanday hosil bo'ladi?** — Kirim × (1 + zavod%); 100 g @8% = 108 g. *`rpc_record_factory_receipt`.*

**88. Zavod qarzi qanday kamayadi?** — Zavodga oltin topshirish (585eq) va [090] tovar qaytarish. *`rpc_record_factory_gold_handover`.*

**89. Zavodga qanday oltin topshiriladi?** — Afinaj oltini, xarid oltini, kapital toza oltin, lom. *O'sha.*

**90. Zavod hisobi manfiy bo'lsa?** — Zavod menejerga qarzdor (bizning avansimiz). *`factoryNetWording`.*

**91. "Kartalar zavod hisobi bilan mos emas" ogohlantirishi?** — Kartalar yig'indisi seyf netidan farq qiladi; production 088 kodida C2 topshiruv xatosi sabab bo'lishi mumkin (091 tuzatadi, eski qiymatni tuzatmaydi). *`factory-account-summary.ts`, RELEASE-090/091.*

**92. Afinaj pateriyasi qanday?** — `kirish585 − chiqish585`; 100 g 585 → 58 g 995 = 1.3504 g. *`rpc_record_refining_batch`.*

**93. Afinajda chiqish kirishdan ko'p bo'lsa?** — Rad: "Anomalous refining result". *O'sha.*

**94. Naqdga oltin xaridida dollar ishlatsam?** — USD kursi majburiy; valyuta USD yoki MIXED. *`rpc_record_gold_purchase`.*

**95. Seyfda pul yetmasa xarid?** — `ERR_INSUFFICIENT_VAULT_CASH` / `USD`. *O'sha.*

**96. Xarajatni qanday kiritaman?** — Asosiy panel → "💸 Xarajat / Kapital amali" → "Ofis va operatsion xarajat". *`rpc_record_financial_transaction`.*

**97. Xarajat sotuvchi kassasidan bo'la oladimi?** — Kodda chiqim/xarajat faqat menejer so'm/$/lom kassasidan; sotuvchi kassasiga faqat kapital kirimi. *O'sha.*

### H. Bekor qilish va vozvrat (98–108)

**98. Savdoni bekor qilsam to'langan pul nima bo'ladi?** — Mijozga avans bo'ladi. *`rpc_reverse_client_sale`.*

**99. Vozvrat qilingan savdoni butunlay bekor qilish?** — Yo'q, `ERR_SALE_HAS_RETURNS`; qolgan qismini vozvrat qiling. *083.*

**100. Vozvratda naqd pul qaytariladimi?** — Yo'q, qarz kamayadi, ortig'i avans. *083.*

**101. Vozvrat qiymati bugungi kursdami?** — Yo'q, asl savdo qiymatining ulushi. *083.*

**102. Dona savdosini qisman qaytarish?** — Yo'q, faqat butun dona. *083.*

**103. Kim "Menejer qabul qiladi" ni tanlay oladi?** — Faqat menejer/direktor. *083.*

**104. SETTL'ni bekor qila olmayapman — "kassadagi ... yetarli emas".** — Pul/lom allaqachon menejerga topshirilgan; avval topshiruvni bekor qiling. *`rpc_reverse_client_settlement`.*

**105. `ERR_TILL_ALREADY_HANDED_OVER`?** — CPAY'dan keyin topshiruv bo'lgan; tartib: topshiruvni bekor → to'lovni bekor → qayta topshirish. *088.*

**106. Sotuvchi o'z savdosini bekor qila oladimi?** — Production'da: o'z savdosini. [090]: faqat o'zi kiritgan, to'lovsiz, ochiq davrdagi savdoni. *077, 090.*

**107. Savdoni tahrirlash?** — [090] "✏️ Tahrirlash": eski bekor + yangi savdo bitta tranzaksiyada. *`rpc_edit_client_sale`.*

**108. Zavod kirimini bekor qila olmayapman.** — Kirimdan tovar tarqatilgan; avval konsignatsiyalarni bekor qiling. *`rpc_reverse_factory_receipt`.*

### I. Hisobot, davr, boshlang'ich hisob (109–120)

**109. Davriy hisobot nimani ko'rsatadi?** — Davr boshi/oxiri qoldiqlari, operatsiya turlari bo'yicha harakatlar, sotuvchilar kesimi. *`rpc_get_period_report`.*

**110. "Yangi davrni boshlash" qoldiqlarni nolga tushiradimi?** — Yo'q; faqat davrni yopib nusxa saqlaydi. *`period-report/page.tsx`.*

**111. Yopilgan davrni qayta ochish?** — Faqat oxirgi saqlangan davr, management. *078.*

**112. Foyda qanday hisoblanadi?** — Sof aktiv o'zgarishi − kapital kirimi + kapital chiqimi − eski qarz deltalari (585 g). *`rpc_get_accounting_profit_summary`.*

**113. Foyda "Hisoblanmagan" deyapti.** — Baseline yo'q yoki kurs (585/USD) yo'q. *O'sha.*

**114. Ustama farqi kimniki?** — Kompaniyaniki (Goldia), sotuvchi majburiyatiga ta'sir qilmaydi. *067.*

**115. Boshlang'ich hisob nima?** — T0 dagi haqiqiy qoldiqlarni A–J hujjatlar bilan kiritish va qulflash. *085.*

**116. `ERR_OPENING_DRAFT` chiqyapti.** — Boshlang'ich davr qoralama yoki restart davom etmoqda; oddiy moliyaviy yozuvlar qulflangan. *`_goldia_guard_opening_draft`.*

**117. `ERR_FINANCIAL_FREEZE`?** — Backup → restart oynasi; yozuvlar vaqtincha to'xtatilgan. *086.*

**118. Baseline sotuvchi kassasi bo'sh bo'lmasa?** — Rad (O-2): kassa T0 dan oldin menejerga topshirilishi kerak. *085.*

**119. "Sinov Tozalash" production'da bormi?** — Yo'q, faqat staging rejimida. *`settings/page.tsx`.*

**120. Restart'da mijozlar o'chadimi?** — Yo'q; mijozlar, xodimlar, modellar, sozlamalar saqlanadi, qoldiqlar 0, hujjatlar arxivlanadi. *OPENING-085-REPORT §1.*

### J. Muammolarni hal qilish jadvali

| Belgi | Ehtimoliy sabab | Qadam |
|---|---|---|
| Tugma bosilmaydi (kulrang) | Majburiy maydon bo'sh / ombordan ko'p / tasdiq katakchasi yo'q | Maydonlarni tekshiring |
| "Kurs belgilanmagan" | `daily_gold_rates` da 585 kurs yo'q | Menejer "⚙️ Kurs" |
| `42501 Ruxsat etilmadi` | Rol yoki mijoz/sotuvchi mos emas | `02-roles-permissions.md` |
| `55000 ERR_OPENING_DRAFT / ERR_FINANCIAL_FREEZE` | Boshlang'ich/restart jarayoni | Direktor bilan bog'laning |
| Qarz kutilganidan katta | Avans/eski qarz yozuvlari | Kunlik jurnal va eski qarz tarixini tekshiring |
| Sotuvchi majburiyati kamaymayapti | Faqat to'lov yozilgan, topshiruv yo'q | Menejer kassani qabul qilsin |
| Kartalar mos emas | C2 topshiruv xatosi (088 kodi) | `factory_cards_readonly.sql` (read-only) |
