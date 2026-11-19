# 06. Ombor, konsignatsiya (sotuvchiga tarqatish) va donalar

> **Tekshiruv pasporti:** commit `052ad17`, schema `20260101000091` (kod). Production: 088 (release hisobotlari bo'yicha, NOT VERIFIED). Sana: 2026-11-19. Misollar sintetik.

## 1. Tovar yo'li (fizik gramm)

```
Zavod ──ZVD kirim──► MENEJER OMBORI ──CONS-BC tarqatish──► SOTUVCHI VITRINASI ──SALE──► MIJOZ
                         ▲                                     │
                         └──── donani qaytarish (↩️) ◄─────────┘
MENEJER OMBORI ──(090) zavodga tovar qaytarish──► ZAVOD
```

Fizik balans tekshiruvi (Asosiy panel, "Fizik Tovar Balansi (585g Bazaviy Sof Vazn)"):
```
zavoddan olingan (faol kirimlar original_physical_g) = menejer ombori + sotuvchilar ombori + sotilgan + zavodga qaytarilgan donalar
```
Farq < 0.001 g bo'lsa balans to'g'ri (`src/app/sales/app/page.tsx`).

## 2. Menejer ombori

**Hisoblash** (`get_manager_available_stock_grams`, 065):
```
menejer ombori = Σ faol kirimlarning available_physical_g
               + kirimsiz konsignatsiyalardan menejerga qaytgan donalar vazni
```
(Kirimli konsignatsiyadan qaytgan dona kirimning o'ziga qaytariladi — ikki marta sanalmaydi.)

**Zavoddan kirim** — `07-factory-manager-accounting.md` §2. Kirim faqat 585 proba: boshqa proba — *"JewelryFlow Sales tayyor mahsulotlar ombori faqat 585 proba uchun mo'ljallangan."*

**Sahifa:** 🏦 Boshqaruvchi Ombori (`/sales/app/inventory`, komponent `SellerInventoryDashboard`): "Partiyalar va mahsulotlar, individual vazn, rasm, sotuv va boshqaruvchiga qaytarish holati." Ko'rinishlar: partiyalar / donalar / jamlangan. Filtrlar: "Barcha Sotuvchilar", "Barcha Holatlar / Faqat Mavjud (Sotilmagan) / Faqat Sotilgan / Boshqaruvchiga Qaytarilgan". Kartalar: Sotuvchilar Vitrinasida, Mijozlarga Sotilgan, Menejerga Qaytarilgan. Dona qatorida "Menejerga Qaytarish" → "Tasdiqlash & Qaytarish".

## 3. Sotuvchiga tarqatish — Scanner 564 (asosiy usul)

**Kim:** direktor, menejer (`inventory_manager` ham). Sotuvchi ❌.
**Qayerda:** 📟 Scanner 564 Tarqatish (`/sales/app/consignments`, `ScannerConsignmentSection`). Sarlavha: *"Model QR kodini va BarTender vazn shtrix-kodlarini skaner qilib sotuvchiga tezkor topshirish."*

**Qadamlar:**
1. "-- Sotuvchini tanlang (Direktor tanlanmaydi) --".
2. "2. Zavod Ustamasi (%)": tugmalar "Zavod 6%", "Zavod 8% (Standart)", "Zavod 10%" yoki aniq qiymat (standart 8.00).
3. "3. Sotuvchi Majburiyati Ustamasi (%)": standart **12.00**.
4. Kirim: "Avtomatik FIFO (Mavjud kirimdan kamaytirish)" yoki aniq kirim.
5. Model QR va vazn shtrix-kodlarini skanerlash ("Hozirgi Faol Model"); har skaner "Qo'shish"; "↩️ Oxirgisini Bekor Qilish (Ctrl+Z)", "Tozalash", qatorda "O'chirish". Jadval: Rasm, Model, Model Kodi, Asl Vazn (585), Xom Shtrix-kod.
6. Tasdiqlash katakchasi ("vazn va ma'lumotlar to'g'riligini tasdiqlovchi katakchani belgilang") → **"✓ Konsignatsiyani Tasdiqlash (N g)"**.

**RPC:** `rpc_issue_barcode_consignment` (090) → hujjat `CONS-BC-XXXXXXXX`.

**Server qoidalari:**
- Kamida 1 dona ("Kamida 1 ta mahsulot dona skaner qilinishi shart").
- Har dona vazni 0 < w ≤ 1000 g.
- Menejer omborida yetarli tovar ("Menejer omborida yetarli tovar yo'q: mavjud % g, talab qilindi % g").
- FIFO: eng eski kirimdan (`receipt_date`, `created_at`) boshlab kamaytiriladi; **090'dan** har kirimdan qancha olingani `consignment_receipt_allocations` ga yoziladi (bekor qilishda aynan o'sha kirimlarga qaytarish uchun).

**Formulalar:**
```
bazaviy vazn          = Σ donalar vazni
zavod qismi           = bazaviy × (1 + zavod% / 100)        (factory_gold_due_grams)
sotuvchi majburiyati  = bazaviy × (1 + sotuvchi% / 100)     (seller_obligation_g)
har dona majburiyati  = dona vazni × (1 + sotuvchi% / 100)
```
**Misol:** 3 dona: 4.00 + 5.00 + 6.00 = 15 g; zavod 8%, sotuvchi 12%.
- zavod qismi = 15 × 1.08 = 16.2 g (ma'lumot uchun; zavod qarzi kirim paytida yaratilgan, bu yerda yangi zavod qarzi yo'q)
- sotuvchi majburiyati = 15 × 1.12 = **16.8 g**

**Ta'sir:**
| Hisob | O'zgarish |
|---|---|
| Menejer ombori | −15 g (kirim(lar)ning `available_physical_g`) |
| Sotuvchi ombori | +15 g (3 ta `held_by_seller` dona) |
| Sotuvchi majburiyati | +16.8 g (`recalc_seller_gold_account`) |
| Zavod hisobi | o'zgarmaydi (test 085 D1-3: "manager -> seller 10 g (factory unchanged)") |

## 4. Mahsulot (katalog) konsignatsiyasi — eski yo'l

`/sales/director` (Direktor Savdo & Konsignatsiya Paneli) → "Mahsulot Topshirish" tabi: sotuvchi, mahsulot (ERP `products`), dona soni, zavod foizi → "Topshirish va Chek Chiqarish". RPC `rpc_issue_seller_consignment` (077). Formula: `bazaviy = mahsulot vazni × soni`, `zavod qismi = bazaviy × (1 + zavod%)`. Bu yo'lda alohida sotuvchi foizi yo'q — majburiyat `coalesce(seller_obligation_g, factory_gold_due_grams)` bo'yicha zavod qismiga teng olinadi (`recalc_seller_gold_account`). **Izoh:** asosiy ish oqimi Scanner 564; bu yo'l menyuda yo'q (faqat `/sales/director`).

## 5. Sotuvchi ombori va donalar

**Hisoblash** (`get_seller_available_stock_grams`, 083):
```
sotuvchi ombori = Σ faol konsignatsiyalar base_weight_grams (held/partially/fully_sold)
                − Σ bekor qilinmagan savdolar base_weight_grams
                + Σ tasdiqlangan vozvratlar returned_weight_grams
```
Sotuvchi faqat o'z qoldig'ini ko'ra oladi.

**Dona holatlari** (`consignment_pieces.status`): `held_by_seller` (vitrinada), `sold`, `returned_to_manager`, `in_manager_stock`, `returned_to_factory`.

**Sotuvchi sahifalari:** ⚡ Skaner Savdo — "Vitrinadagi Mahsulotlar Ro'yxati" (har donada "↩️ Qaytarish", "⚡ Sotish") va "O'zimdagi Mahsulotlar (Vitrina)" (Asl Vazn, Zavod Ustamasi, Zavod Majburiyati).

## 6. Donani menejerga qaytarish

**Kim:** sotuvchi (faqat o'ziga biriktirilgan, sotilmagan dona), management.
**Qayerda:** sotuvchi vitrinasida "↩️ Qaytarish" ("Ushbu mahsulotni menejer omboriga qaytarish") yoki Boshqaruvchi Ombori → "Menejerga Qaytarish".
**RPC:** `rpc_return_piece_to_manager` (090).
**Formula:** `kamayadigan majburiyat = dona vazni × (1 + dona yoki konsignatsiya sotuvchi% / 100)` (standart 12%).
**Misol:** 5 g dona, sotuvchi foizi 12% → majburiyat −5.6 g; sotuvchi ombori −5 g; menejer ombori +5 g (090: aynan dona olingan kirim(lar)ga qaytadi, kirim bergan miqdordan oshmaydi).
Xabar: "Mahsulot boshqaruvchiga qaytarildi va majburiyat 5.60 g ga kamaytirildi!"
**Rad:** dona `held_by_seller` emas ("Faqat sotuvchi javonidagi (sotilmagan) mahsulotni boshqaruvchiga qaytarish mumkin"); begona dona.

## 7. Konsignatsiyani bekor qilish

**Qayerda:** konsignatsiyalar ro'yxatida bekor qilish (sotilgan bo'lsa "🔒 Sotilgan"). RPC `rpc_reverse_barcode_consignment`, sabab majburiy, faqat management.

| Versiya | Xatti-harakat |
|---|---|
| **Production (≤088)** | 039-versiya: barcha grammlar konsignatsiyada saqlangan **bitta** kirimga qaytariladi; 090 hisobotida aniqlangan xatolar: ko'p kirimli FIFO konsignatsiyada kirim bergandan ko'p qaytishi, vozvratlarni ikki marta ayirish, davr hisobotida ikki marta sanash, sotuvchi hisobini qayta hisoblamaslik, boshlang'ich B konsignatsiyani bekor qilish imkoniyati. (Manba: `RELEASE-090-REPORT.md` §1b.) |
| **090 (deploy qilinmagan)** | Kirim taqsimotlari bo'yicha aniq qaytarish; 090'dan oldingi ko'p kirimli konsignatsiya — `ERR_CONSIGNMENT_RECEIPT_UNKNOWN` (hech narsa taxmin qilinmaydi); boshlang'ich B — `ERR_OPENING_CONSIGNMENT`; 089 vozvrat loti — `ERR_RETURN_LOT`; kirimsiz — `ERR_CONSIGNMENT_NO_RECEIPT`; sotilgan donasi bor — rad. |

**Ta'sir (090):** donalar sotuvchidan chiqadi; sotuvchi ombori va majburiyati kamayadi; menejer ombori (kirim `available_physical_g`) tiklanadi.

## 8. Ombor harakati sahifasi — **089, DEPLOY QILINMAGAN**

`/sales/app/stock-movements` ("📦 Ombor harakati (sotuvchilar)"): *"Faqat ko'rish: farqlar va takrorlar ko'rsatiladi, balanslar avtomatik tuzatilmaydi."* Filtr: Sotuvchi, Dan, Gacha. Jadval: Sotuvchi, Boshida, Kirim, Chiqim, Oxirida, Hisobdagi qoldiq, Javondagi donalar, Holat ("✓ mos"). Bo'lim: "⚠ Ehtimoliy takrorlar (10 daqiqa ichida bir xil vazn) — tekshiring, avtomatik o'zgartirilmaydi". RPC `rpc_get_seller_stock_movements` (STABLE, faqat o'qish).

## 9. BarTender modellar

🏷️ BarTender & Modellar (`/sales/app/models`): model katalogi, rasm, etiketka parametrlari, doimiy QR. RPC: `rpc_create_jewelry_model` (074), `rpc_update_jewelry_model_photo`. Modellar tashkilot bo'yicha izolyatsiyalangan (074).

## 10. Asosiy invariantlar (testlar)

- "the grams of the held pieces always equal the seller's gram stock" (`rpc_record_weight_sale` 076 izohi; test `goldia-weight-sale-pieces.test.ts`).
- "no piece is sold twice" — sotuvchi bo'yicha advisory lock.
- Stock movements: "all-time = stored stock for every seller" (089 hisobot).
