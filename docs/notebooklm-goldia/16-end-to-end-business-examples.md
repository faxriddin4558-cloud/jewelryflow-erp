# 16. End-to-end biznes misollari (sintetik)

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (NOT VERIFIED). Sana: 2026-11-19.
> Barcha ism va raqamlar **sintetik**. Ishtirokchilar: menejer **M**, sotuvchi **S**, mijozlar **K1, K2, K3**. Yaxlitlash 4 xona (server kabi).

## Misol 1. To'liq zanjir: zavod → sotuvchi → mijoz → kassa → afinaj → zavod

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

## Misol 2. Dollar narxidagi savdo va aralash CPAY

| Qadam | Amal | Hisob |
|---|---|---|
| 1 | S K2 ga 5 g ni **600 $** ga sotadi (`rpc_record_currency_sale`) | S ombori 30 → 25; K2 USD qarzi 600 $; 585 qarzi o'zgarmaydi; S majburiyati 35.4 o'zgarmaydi |
| 2 | K2 CPAY (USD qarz): 300 $ + 2 540 000 so'm, USD 12 700 | kredit = 300 + 2 540 000/12 700 = 300 + 200 = **500 $** → qarz 100 $. S kassasi +300 $, +2 540 000 so'm (qiymatlanmagan) |
| 3 | M kassani qabul qiladi, LOM 950 000, USD 12 700 | so'm 2 540 000/950 000 = 2.6737 g; $ 300×12 700/950 000 = 4.0105 g; jami **6.6842 g** → S majburiyati 35.4 − 6.6842 = **28.7158 g** |

## Misol 3. Qisman to'langan savdoni bekor qilish

| Qadam | Hisob |
|---|---|
| K3 ga 10 g @12% | qarz 11.2 g |
| K3 4 g 585 lom bilan to'laydi | qarz 7.2 g; S kassasi lom +4 g |
| Savdo bekor qilinadi (`rpc_reverse_client_sale`, sabab "noto'g'ri mijoz") | net = 7.2 − 0 − 11.2 = −4 → qarz 0, **avans 4 g**; S ombori +10 g; S majburiyati o'zgarmaydi; kassa (4 g lom) qoladi |

## Misol 4. Ikki bosqichli vozvrat

Savdo 20 g @12% = 22.4 g. Mijoz 17.4 g to'lagan (qarz 5 g).

| Vozvrat | Qiymat | Qarz | Avans | Sotuvchi ombori |
|---|---|---|---|---|
| V1: 6 g sotuvchi javoniga | 22.4 × 6/20 = **6.72** | 5 → 0 | +1.72 | +6 |
| V2: qolgan 14 g (oxirgi) | qoldiq = 22.4 − 6.72 = **15.68** | 0 | 1.72 + 15.68 = **17.4** | +14 |

Tekshiruv: jami avans 17.4 = mijoz to'lagan summa ✔; vozvratlar yig'indisi = savdo qiymati 22.4 ✔ (oxirgi vozvrat aniq qoldiqni oladi). Sotuvchi majburiyati o'zgarmaydi (tovar sotuvchida).

## Misol 5. Konsignatsiya reversali: production (088) va 090 farqi

Kirimlar: R1 da 10 g, R2 da 20 g qolgan. Konsignatsiya 15 g (4+5+6), FIFO: R1 dan 10, R2 dan 5. Sotuvchi 12% → majburiyat 16.8 g. Hech narsa sotilmagan.

| | Production 088 (039-mantiq) | 090 (deploy qilinmagan) |
|---|---|---|
| Qaytish | 15 g hammasi bitta saqlangan kirimga (R1) — R1 bergan 10 g dan oshadi | R1 +10, R2 +5 (`consignment_receipt_allocations` bo'yicha) |
| Sotuvchi | ombor −15, majburiyat −16.8 | ombor −15, majburiyat −16.8, `recalc` chaqiriladi |
| Davriy hisobot | ikki marta sanash xatosi bo'lishi mumkin | bir marta |
Manba: `RELEASE-090-REPORT.md` §1b.

## Misol 6. Kursli boshlang'ich so'm qarzi (F) — to'lov va topshiruv (test 085 D-2)

| Qadam | Hisob |
|---|---|
| T0: F hujjat 8 600 000 so'm @ 860 000 | sotuvchi majburiyati +**10 g** (bir marta) |
| Mijoz 8 600 000 so'm to'laydi (CPAY) | mijoz so'm qarzi 0; havzaga 8 600 000 ↔ 10 g |
| Topshiruv 900 000 kursida | majburiyat −**10 g** (aniq); kompaniya kurs farqi 10 − 8 600 000/900 000 = **0.4444 g** |

## Misol 7. Kurssiz boshlang'ich so'm qarzi (088)

| Qadam | Hisob |
|---|---|
| T0: F hujjat 4 500 000 so'm, kurssiz | "Hali hisoblanmagan"; sotuvchi majburiyati 0 |
| To'lov 1 800 000 so'm, LOM 900 000 | shu qism baholanadi: 1 800 000/900 000 = **2 g** → majburiyat +2 g; havzaga 1 800 000 ↔ 2 g; qolgan F 2 700 000 (kurssiz) |
| Topshiruv | 2 g yopiladi → sof ta'sir 0 |
| Keyingi to'lov 2 700 000, LOM 950 000 | 2 700 000/950 000 = 2.8421 g baholanadi |

## Misol 8. To'lovni bekor qilish tartibi (topshiruvdan keyin)

| Qadam | Natija |
|---|---|
| SETTL 900 000 so'm @900 000 (1 g) | mijoz qarzi −1 g; kassa +900 000 |
| Topshiruv (900 000) | majburiyat −1 g; kassa 0; seyf +900 000 |
| SETTL'ni bekor qilish | **Rad**: "Sotuvchi kassasidagi naqd so'm yetarli emas" |
| Avval topshiruvni bekor qilish | seyf −900 000; kassa +900 000; majburiyat +1 g |
| Endi SETTL'ni bekor qilish | mijoz qarzi +1 g; kassa 0 |

## Misol 9. Davr foydasi

Baseline sof aktiv: **1 000 g**. Hozir: aktivlar 1 300 g (ombor 500 + mijoz qarzlari 400 + kassa 585eq 300 + lom 100), majburiyatlar 220 g (zavod qarzi 200 + mijoz avanslari 20) → sof aktiv **1 080 g**.
Davrda: kapital kirimi 30 g, foyda taqsimoti 10 g, baseline'dan keyingi eski qarz deltalari +5 g, xarajat 12 g (sof aktivni allaqachon kamaytirgan).
**Natija** = (1080 − 1000) − 30 + 10 − 5 = **55 g** (xarajat qayta qo'shilmaydi). Manba: `rpc_get_accounting_profit_summary`.

## Misol 10. Ustama farqi

Sotuvchiga 12% bilan berilgan 20 g. Sotuvchi K1 ga 10 g ni 15% bilan, K2 ga 10 g ni 10% bilan sotdi.
- K1: 10 × (15 − 12)/100 = **+0.3 g**; K2: 10 × (10 − 12)/100 = **−0.2 g**; jami **+0.1 g** (kompaniyaniki).
- Sotuvchi majburiyati 22.4 g o'zgarmaydi; K1 qarzi 11.5 g, K2 qarzi 11 g.
