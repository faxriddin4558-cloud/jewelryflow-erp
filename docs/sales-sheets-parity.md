# JEWELRYFLOW ERP + SALES — GOOGLE SHEETS PARITY SPECIFICATION & MAPPING
## Moliyaviy Mantiq, Buxgalteriya Invariantlari va Google Sheets Taqsimoti

Ushbu hujjat JewelryFlow ERP tizimining real Google Sheets jadvallari bilan 1:1 muvofiqligi (parity), buxgalteriya hisob-kitoblari, formulalari va invariantlarini to'liq belgilab beradi.

---

## 1. ASOSIY BIZNES ZANJIRI (ABSOLUTE SOURCE OF TRUTH)

Zavod, Boshqaruvchi (Direktor/Operator), Sotuvchi va Mijozlar o'rtasidagi harakat quyidagi qat'iy zanjir bo'yicha amalga oshadi:

```
ZAVOD (FACTORY)
  │ (1. Zavoddan tovar olish @ factory_markup_pct)
  ▼
BOSHQARUVCHI (MANAGER) ─── Ombor: Boshqaruvchi tayyor mahsulotlari
  │ (2. Sotuvchiga o'tush @ seller_markup_pct [Non-compounding])
  ▼
SOTUVCHI (SELLER) ──────── Ombor: Sotuvchi mahsulotlari
  │ (3. Nasiya savdo @ client_markup_pct)
  ▼
MIJOZ (CUSTOMER)
  │ (4. Qaytim: Lom oltin yoki Naqd UZS [Muzlatilgan kunlik kurs])
  ▼
SOTUVCHI KASSASI (SELLER TILL) ── Lom gramm va Naqd UZS
  │ (5. Sotuvchi boshqaruvchiga topshirishi)
  ▼
BOSHQARUVCHI KASSASI (MANAGER VAULT) ── Lom gramm va Naqd UZS
  ├── (6. Afinaj / Pateriya ── Yo'qotish Boshqaruvchi hisobiga) ──► Qayta ishlangan oltin (999 / 585 eq)
  ├── (7. Tovar olish / Oltin xarid ── Naqd pul sarflab) ──────────► Xarid qilingan oltin (Lom / 999)
  │
  ▼ (8. Zavodga oltin topshirish ── Faqat shu hodisa zavod qarzini kamaytiradi!)
ZAVOD MAJBURIYATI KAMAYISHI (FACTORY SETTLEMENT)
```

### 3 ta alohida qarz munosabati (Three Distinct Debt Relationships):
1. **Mijozning sotuvchi oldidagi qarzi (`customer_debt_g`)**:
   Mijoz faqat o'zi xarid qilgan mahsulot va unga berilgan mijoz ustamasi bo'yicha sotuvchiga qarzdor bo'ladi.
2. **Sotuvchining boshqaruvchi oldidagi hisobi (`seller_owes_manager_g` / `bozor_qarzi_signed_g`)**:
   Sotuvchi boshqaruvchidan olingan tovarlar bo'yicha boshqaruvchiga javobgar.
3. **Boshqaruvchining zavod oldidagi majburiyati (`current_factory_obligation_g`)**:
   Boshqaruvchi zavoddan olingan tovarlar va zavod ustamasi bo'yicha zavodga javobgar.

### Alohida moddiy zaxiralar (Physical Holdings):
- **Zavod tayyor mahsulotlari**
- **Boshqaruvchi tayyor mahsulotlari ombori** (`manager_inventory`)
- **Sotuvchi tayyor mahsulotlari ombori** (`seller_inventory`)
- **Boshqaruvchi lom oltin zaxirasi** (`manager_scrap_grams`)
- **Boshqaruvchi naqd puli** (`manager_cash_amount` UZS)
- **Afinaj jarayonidagi oltin** (`refining_wip`)
- **Qayta ishlangan toza oltin** (`manager_refined_gold_grams`)
- **Xarid qilingan oltin** (`manager_purchased_gold_grams`)
- **Zavodga topshirilgan va qabul qilingan oltin** (`total_factory_handed_over_g`)

Ushbu balanslar hech qachon bir-biriga qo'shib yuborilmaydi!

---

## 2. FORMULALAR VA HISOBLASH QOIDALARI

### A. Zavoddan tovar olish ("Zavod bilan")
Boshqaruvchi zavoddan zargarlik buyumlarini qabul qiladi:
$$\text{factory\_obligation\_g} = \text{original\_physical\_g} \times \left(1 + \frac{\text{factory\_markup\_pct}}{100}\right)$$
*Misollar:*
- $194.75\text{ g} \times 1.08 = 210.33\text{ g}$
- $65.14\text{ g} \times 1.08 = 70.35\text{ g}$
- $100.00\text{ g} \times 1.08 = 108.00\text{ g}$

### B. Sotuvchiga tovar berish ("O'tush") — Non-Compounding Qoidasi
Boshqaruvchi mavjud mahsulotni sotuvchiga o'tkazadi:
$$\text{seller\_obligation\_g} = \text{original\_physical\_g} \times \left(1 + \frac{\text{seller\_markup\_pct}}{100}\right)$$
*Qat'iy qoida:* Zavod ustamasi ham, sotuvchi ustamasi ham **faqat va faqat asl fizik vaznga** qo'llaniladi. Zavod ustamasi ustiga yana sotuvchi foizi minilmaydi ($108 \times 1.12$ qilinmaydi, to'g'ri formula: $100 \times 1.12 = 112$).
Farq: $218.12\text{ g} - 210.33\text{ g} = 7.79\text{ g}$. Bu zavod tomonidagi hisob-kitob farqi bo'lib, boshqaruvchining shaxsiy daromadi hisoblanmaydi.

### C. Mijozga nasiya savdo va asosiy hisob birligi
Mijoz qarzi lom oltin grammida yuritiladi:
$$\text{cash\_equivalent\_g} = \frac{\text{cash\_received\_uzs}}{\text{scrap\_price\_uzs\_per\_g}}$$
$$\text{customer\_debt\_g} = \sum \text{sale\_obligations\_g} - \sum \text{scrap\_received\_g} - \sum \text{cash\_equivalent\_g}$$
*Misol:*
- Sotuv majburiyati: $112\text{ g}$
- Qaytarilgan lom: $70\text{ g}$
- Qaytarilgan naqd: $18\,000\,000\text{ UZS}$, kurs: $900\,000\text{ UZS/g} \implies 20\text{ g}$
- Qolgan qarz: $112 - 70 - 20 = 22\text{ g}$
*Tarixiy kurs:* O'tgan sanadagi to'lov kursi o'sha operatsiya paytida muzlatiladi va kelajakdagi kurs o'zgarishlarida qayta hisoblanmaydi.

### D. Sotuvchi "Bozor qarzi" ishora konvensiyasi (Sheets Parity)
Egasi (Owner) tomonidan tasdiqlangan Google Sheets konvensiyasi:
- **MUSBAT (+) "Bozor qarzi":** BIZ SOTUVCHIGA QARZDORMIZ (Sotuvchi oldindan ortiqcha to'lov yoki avans topshirgan).
- **MANFIY (-) "Bozor qarzi":** SOTUVCHI BIZGA QARZDOR (Sotuvchida yopilmagan tovar majburiyati bor).

Ichki o'zgaruvchilar:
$$\text{bozor\_qarzi\_signed\_g} = \text{manager\_owes\_seller\_g} - \text{seller\_owes\_manager\_g}$$
Ekranda doimo matnli izoh ko'rsatiladi:
- Manfiy bo'lsa: `"Sotuvchi bizga qarzdor: X gramm"`
- Musbat bo'lsa: `"Biz sotuvchiga qarzdormiz: X gramm"`
- Nol bo'lsa: `"Hisob yopilgan"`

### E. Afinaj — "Lom pateriya"
Afinaj yo'qotishi (pateriya) **to'liq boshqaruvchi hisobiga** yoziladi.
Sotuvchiga qayta yuklatilmaydi, zavod qarzini avtomatik kamaytirmaydi.
$$\text{output\_585\_equiv\_g} = \text{output\_fine\_g} \times \left(\frac{\text{output\_fine\_proba}}{585}\right)$$
$$\text{total\_loss\_g} = \text{input\_scrap\_g} - \text{output\_585\_equiv\_g}$$
$$\text{loss\_pct} = \left(\frac{\text{total\_loss\_g}}{\text{input\_scrap\_g}}\right) \times 100$$

### F. Oltin sotib olish ("Tovar olish")
Kassadagi naqd pulga oltin xarid qilish:
- Naqd pul kamayadi: $\Delta \text{cash} = -\text{cash\_spent\_uzs}$
- Xarid qilingan oltin zaxirasi oshadi: $\Delta \text{purchased\_gold} = +\text{gold\_weight\_grams}$
- Zavod qarziga daxl qilmaydi!

### G. Zavodga oltin topshirish ("Zavodga topshirish")
Faqatgina zavodga jismonan topshirilgan va tasdiqlangan oltin topshirilgandagina boshqaruvchining zavod oldidagi qarzi kamayadi:
$$\text{current\_factory\_obligation\_g} = \text{total\_factory\_obligation\_g} - \text{total\_factory\_handed\_over\_g}$$

---

## 3. GOOGLE SHEETS JADVALLARINING DASTURGA MOSLIGI (FIELD MAPPING)

### Sheet A: "Zavod bilan"
| Google Sheets Ustuni | Tizimdagi Maydon | Birlik | Hisoblash / Manba | Holati |
|---|---|---|---|---|
| Sana | `factory_receipts.receipt_date` | YYYY-MM-DD | Qabul qilingan sana | Tasdiqlangan |
| Mahsulot nomi | `factory_receipts.product_name` | Matn | Mahsulot yoki model | Tasdiqlangan |
| Asl vazn (gr) | `factory_receipts.original_physical_g` | Gramm | Zavoddan kelgan sof vazn | Tasdiqlangan |
| Zavod ustamasi (%) | `factory_receipts.factory_markup_pct` | Foiz | Masalan, 8% | Tasdiqlangan |
| Zavod majburiyati (gr) | `factory_receipts.factory_obligation_g` | Gramm | `original_physical_g * (1 + pct/100)` | Tasdiqlangan |
| Topshirilgan oltin (gr) | `factory_gold_handovers.agreed_equivalent_g`| Gramm | Zavodga topshirilgan toza/585 eq | Tasdiqlangan |
| Qolgan qarz (gr) | `manager_factory_account.current_factory_obligation_g` | Gramm | Jami majburiyat - Jami topshirilgan | Tasdiqlangan |

### Sheet B: "Tovar olish"
| Google Sheets Ustuni | Tizimdagi Maydon | Birlik | Hisoblash / Manba | Holati |
|---|---|---|---|---|
| Sana | `gold_purchases.purchase_date` | YYYY-MM-DD | Xarid sanasi | Tasdiqlangan |
| Kimdan (Ta'minotchi) | `gold_purchases.supplier_name` | Matn | Bozor yoki shaxs nomi | Tasdiqlangan |
| Sarflangan pul (so'm) | `gold_purchases.cash_spent_uzs` | UZS | Boshqaruvchi kassasidan chiqim | Tasdiqlangan |
| Xarid kursi (so'm/gr) | `gold_purchases.rate_per_gram` | UZS/g | Kelishilgan gramm narxi | Tasdiqlangan |
| Olingan oltin vazni | `gold_purchases.gold_weight_grams` | Gramm | Xarid qilingan oltin vazni | Tasdiqlangan |
| Proba | `gold_purchases.proba` | Son (masalan 585, 999) | Oltin probasi | Tasdiqlangan |
| 585 ekvivalenti | `gold_purchases.equiv_585_grams` | Gramm | `weight * (proba / 585)` | Tasdiqlangan |

### Sheet C: "Lom pateriya"
| Google Sheets Ustuni | Tizimdagi Maydon | Birlik | Hisoblash / Manba | Holati |
|---|---|---|---|---|
| Sana | `refining_batches.batch_date` | YYYY-MM-DD | Afinaj sanasi | Tasdiqlangan |
| Kirgan lom (gr) | `refining_batches.input_scrap_grams` | Gramm | Eritishga berilgan lom | Tasdiqlangan |
| Eritilgandagi grami (gr) | `refining_batches.melted_weight_grams` | Gramm | Eritilgandan keyingi quyma vazni | Tasdiqlangan |
| Chistiy grami (gr) | `refining_batches.output_fine_grams` | Gramm | Chiqqan toza oltin vazni | Tasdiqlangan |
| Chistiy probasi | `refining_batches.output_fine_proba` | Son (995, 999.9) | Toza oltin probasi | Tasdiqlangan |
| 585 ekvivalenti (gr) | `refining_batches.output_585_equiv_grams` | Gramm | `fine_g * (fine_proba / 585)` | Tasdiqlangan |
| Umumiy kamayish (gr) | `refining_batches.total_loss_grams` | Gramm | `input_scrap - output_585_equiv` | Tasdiqlangan |
| Kamayish foizi (%) | `refining_batches.loss_pct` | Foiz | `(total_loss / input_scrap) * 100` | Tasdiqlangan |

### Sheets D, E, F: "Sanatoni sotuv", "O'tush sotuv", "Buxoro sotuv"
| Google Sheets Ustuni | Tizimdagi Maydon | Birlik | Hisoblash / Manba | Holati |
|---|---|---|---|---|
| Sana | `seller_consignments.issued_at` / `jewelry_sales.sale_date` | Sana | Operatsiya sanasi | Tasdiqlangan |
| Berilgan tovar vazni | `seller_consignments.base_weight_grams` | Gramm | Asl fizik vazn | Tasdiqlangan |
| Ustama foizi (%) | `seller_consignments.seller_markup_pct` | Foiz | Masalan, 12% | Tasdiqlangan |
| Sotuvchi majburiyati (gr)| `seller_consignments.seller_obligation_g` | Gramm | `base_weight * (1 + pct/100)` | Tasdiqlangan |
| Qaytarilgan lom (gr) | `gold_settlements.scrap_weight_grams` | Gramm | Sotuvchi topshirgan lom | Tasdiqlangan |
| Qaytarilgan pul (so'm) | `gold_settlements.cash_paid_amount` | UZS | Sotuvchi topshirgan naqd pul | Tasdiqlangan |
| Kurs (so'm/gr) | `gold_settlements.gold_rate_applied` | UZS/g | Muzlatilgan kunlik kurs | Tasdiqlangan |
| Pul gramm ekvivalenti | `gold_settlements.cash_equivalent_grams`| Gramm | `cash / rate` | Tasdiqlangan |
| Jami qaytim (gr) | `gold_settlements.total_settled_grams` | Gramm | `scrap + cash_equiv` | Tasdiqlangan |
| Bozor qarzi (gr) | `seller_gold_accounts.bozor_qarzi_signed_g` | Gramm | `manager_owes - seller_owes` | Tasdiqlangan |

---

## 4. INVARIANTLAR VA MUVOZANAT TEKSHIRUVI (RECONCILIATION INVARIANTS)

1. **Tovar jismoniy saqlanishi (Physical Conservation):**
   $$\text{Zavoddan kelgan} = \text{Boshqaruvchi ombori} + \text{Sotuvchilar ombori} + \text{Mijozlarga sotilgan} + \text{Zavodga qaytarilgan}$$
2. **Non-compounding ustama yaxlitligi:**
   Zavod va sotuvchi ustamasi bir-biriga minilmaydi, har doim asl mahsulot vaznidan olinadi.
3. **Muzlatilgan tarixiy kurs:**
   Kurs o'zgarishi tarixiy to'lovlar va qarzlarni hech qachon o'zgartirmaydi.
4. **Kassa ajratilishi:**
   Sotuvchi kassasi va Boshqaruvchi kassasi mutlaqo alohida; mijoz to'lovi sotuvchi kassasiga tushadi, sotuvchi topshirgandagina boshqaruvchi kassasiga o'tadi.
5. **Zavod qarzi xavfsizligi:**
   Zavod qarzi mijoz to'laganda, sotuvchi topshirganda, afinaj tugaganda yoki oltin xarid qilinganda KAMAYMAYDI. Faqat va faqat zavodga tasdiqlangan topshirish hujjati bilan kamayadi.
6. **Bozor qarzi ishora aniqligi:**
   Sotuvchi qarzdor bo'lsa manfiy (-), biz qarzdor bo'lsak musbat (+) ko'rinadi va doimo tushunarli matn bilan birga ifodalanadi.
