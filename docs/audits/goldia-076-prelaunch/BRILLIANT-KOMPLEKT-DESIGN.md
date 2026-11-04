# Brilliant komplekt — gramm+% bilan berish, USD/UZS summada sotish (DIZAYN, kod emas)

**Holat:** taklif. Production'ga ham, staging'ga ham hech narsa qo'shilmadi. Ertalabki release'ga kirmaydi.
Quyidagi **D1–D6 qarorlarini egasi tasdiqlamaguncha** foyda yoki konversiya qoidasi kodga yozilmaydi.

## 1. Muammo: hozirgi model nimani bilmaydi
Hozirgi Goldia modeli hamma narsani **585 gramm-ekvivalentda** yuritadi: mijoz qarzi gramm, sotuvchi majburiyati gramm,
to'lov (UZS/USD/lom) to'lov paytidagi kurs bilan grammga aylantiriladi. Brilliant komplektda esa:

| Narsa | Birligi | Kim belgilaydi |
|---|---|---|
| Komplektdagi oltin (fizik) | gramm (585) | zavod / menejer |
| Sotuvchining menejer oldidagi majburiyati | gramm + % (masalan 12 %) | menejer |
| Toshlar (brilliant) | dona / karat, narxi USD | menejer / zavod |
| Mijozga sotish narxi | **USD yoki UZS summa** | sotuvchi (kelishuv) |
| Mijoz qarzi | **valyutada** (USD yoki UZS), grammda emas | savdo hujjati |

Mijoz qarzini grammga aylantirish (hozirgi model) brilliant uchun xato bo'ladi: mijoz "1 200 USD" qarzdor, oltin kursi
o'zgarsa uning qarzi o'zgarmasligi kerak.

## 2. Tavsiya etiladigan model (alohida hisoblar)
1. **Fizik ombor** — oddiy oltin kabi: komplekt donasi (barcode) sotuvchiga beriladi, sotilganda sotuvchi omboridan
   `weight_grams` ayriladi. Ikki marta sotish / manfiy ombor himoyasi hozirgi barcode yo'li bilan bir xil.
2. **Sotuvchi majburiyati (gramm)** — o'zgarmaydi: `oltin_g × (1 + sotuvchi_% / 100)`; toshlar uchun alohida
   `stone_obligation_usd` (D2). Sotuvchi menejerga gramm (lom/naqd/USD → gramm, mavjud topshiruv qoidasi) va tosh
   majburiyatini USD'da topshiradi.
3. **Mijoz qarzi (valyuta)** — yangi hisob: `client_currency_accounts(customer_id, currency, debt_amount,
   advance_amount)`; savdo `sale_currency`, `sale_amount` bilan yoziladi. Mijozning gramm qarzi bilan **aralashmaydi**.
4. **Kurs snapshot** — savdo paytida: `usd_uzs_rate_at_sale`, `lom_585_rate_at_sale` (sotuvchining o'z kursi yoki
   rasmiy — D3), `snapshot_source`. Keyin kurs o'zgarsa tarixiy hujjat o'zgarmaydi.
5. **Foyda** — alohida hisobot qatori: `sale_amount` (snapshot kursida UZS) − (gramm majburiyati × snapshot LOM
   kursi) − tosh tannarxi. Qaysi kurs va qaysi tannarx — **D4**. Tasdiqlanmaguncha foyda "hisoblanmagan" deb
   ko'rsatiladi, kompaniya foydasiga qo'shilmaydi.

## 3. Misol (taxminiy raqamlar, faqat tushuntirish uchun)
Komplekt: oltin 8.0000 g, sotuvchi ustamasi 12 %, 1 ta brilliant (tannarx 450 USD). Sotuvchi mijozga **1 200 USD**
ga nasiyaga sotadi; savdo paytida 1 USD = 12 500 UZS, sotuvchining LOM kursi 890 000 UZS/g.

| Hisob | Harakat | Natija |
|---|---|---|
| Sotuvchi ombori | −8.0000 g | fizik oltin kamayadi |
| Sotuvchi majburiyati (gramm) | o'zgarmaydi | 8 × 1.12 = **8.9600 g** (berilganda yozilgan) |
| Sotuvchi tosh majburiyati | o'zgarmaydi | **450 USD** (D2) |
| Mijoz qarzi (USD) | +1 200 USD | gramm qarzi o'zgarmaydi |
| Snapshot | 12 500 UZS/USD, 890 000 UZS/g | hujjatda saqlanadi |
| Foyda (D4 bo'yicha, misol) | 1 200 × 12 500 − 8.96 × 890 000 − 450 × 12 500 | 15 000 000 − 7 974 400 − 5 625 000 = **1 400 600 UZS** (faqat ko'rsatiladi) |

Mijoz keyin 500 USD to'laydi → USD qarzi 700 USD (kursdan qat'i nazar). UZS'da to'lasa: qaysi kursda USD qarzidan
ayiriladi — **D5** (to'lov kunidagi sotuvchi USD kursi tavsiya etiladi; rate-mismatch himoyasi hozirgidek).

## 4. Database ta'siri (alohida migration, 077+, faqat tasdiqdan keyin)
* `jewelry_sales`: `sale_currency text check in ('GRAM','USD','UZS') default 'GRAM'`, `sale_amount numeric(18,2)`,
  `usd_uzs_rate_at_sale`, `lom_585_rate_at_sale`, `profit_status` (`not_computed` / `computed`).
* yangi `client_currency_accounts` (+ RLS: tashkilot + sotuvchi, mavjud `client_gold_accounts` siyosatlari kabi).
* yangi RPC `rpc_record_brilliant_set_sale(customer, piece_id, currency, amount, idempotency_key)` — SECURITY
  DEFINER, sotuvchi faqat o'z mijozi va o'z donasi (076 qoidasi), idempotentlik, per-seller lock.
* to'lov: `rpc_record_client_currency_settlement` yoki mavjud to'lovga `p_target_currency` (D5).
* reversal: savdo bekor qilinganda dona qaytadi, USD qarzi ayiriladi (mavjud `rpc_reverse_client_sale` naqshi).
* hisobotlar: kunlik ledger va mijoz ledgeri valyuta ustunlari bilan; kompaniya foydasi `profit_status='computed'`
  qatorlarni faqat D4 tasdiqlangandan keyin oladi.

## 5. UI ta'siri
* "Nasiya Sotuv" oynasida uchinchi rejim: **Brilliant komplekt (USD/UZS)** — dona (barcode) tanlash majburiy, summa
  va valyuta, snapshot kurslar faqat ko'rsatiladi (sotuvchi o'zgartirmaydi).
* Mijoz kartasida ikki qoldiq: "Oltin qarzi (g)" va "Valyuta qarzi (USD/UZS)" — hech qachon bitta raqamga
  qo'shilmaydi.
* Kvitansiyada valyuta summasi, kurs snapshot va komplekt tarkibi.

## 6. Egasi hal qilishi kerak bo'lgan qarorlar
* **D1** Brilliant komplekt alohida mahsulot turi bo'ladimi (model/BarTender) yoki barcode donaga belgi?
* **D2** Toshlar uchun sotuvchi majburiyati USD'da alohidami yoki komplekt narxiga kiradimi?
* **D3** Snapshot LOM kursi: sotuvchining o'z kursimi yoki rasmiy 585 kursimi?
* **D4** Foyda formulasi: qaysi kurs, tosh tannarxi qayerdan, foyda qachon tan olinadi (savdoda yoki to'liq to'lovda)?
* **D5** UZS / lom bilan to'langan USD qarzi qaysi kursda yopiladi?
* **D6** Aralash: bitta mijozda gramm va valyuta qarzi bo'lsa avans qaysi qarzga birinchi yoziladi?

**Ertalab uchun qoida:** brilliant komplektni tizimda **oddiy gramm savdo sifatida rasmiylashtirmang** (mijoz qarzi
noto'g'ri grammga aylanadi). D1–D6 tasdiqlanib, 077 staging'da sinovdan o'tguncha bunday savdolar alohida qayd etiladi.
