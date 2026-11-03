# Goldia Sales 075 — haqiqiy STAGING saytida Playwright UI auditi (haqiqiy Supabase Auth)

**Sana:** 2026-11-03 · **Sayt:** https://jewelryflow-sales-staging.vercel.app (`/api/version`: `ddff86f`, `env=staging`, `supabase_ref=vouehtlmsunebracahon`)
**Brauzer:** Chromium (Playwright), desktop 1366×860 va mobil 390×844. **Loginlar:** haqiqiy GoTrue, `/sales/login` formasi orqali.
Yangi vaqtinchalik loginlar `audit.ui075.*` faqat staging’da, sintetik `GOLDIA-AUDIT-075-A` / `-B` tashkilotlarida yaratildi; audit oxirida 10 tasi bloklandi (login → 400).
Oldingi 732 ta API operatsiyasining dalillari o‘zgarmagan (`sim30-d30a.json` va boshqalar). Bu hujjat faqat **brauzer UI** qamrovi.
Production, JFS Demo, manufacturing ERP — tegilmagan. Migratsiya yoki deploy qilinmadi.

Har bir UI amalidan keyin DB (service role, faqat o‘qish) mustaqil kutilgan qiymat bilan solishtirildi. Dalil: `evidence/ui-operations.json`
(har tekshiruv: expected / actual / record ID), skrinshotlar: `evidence/ui-screens/` (46 ta).

## UI testlari soni

| | Soni |
|---|---|
| Jami UI tekshiruvlari | **111** (98 PASS, 13 FAIL) |
| Shulardan keyin qayta bajarilgan urinishlar (selektor/harness sababli) | 21 (8 FAIL) — evidence’da `-try1/-try2` deb saqlangan |
| **Yakuniy UI tekshiruvlari** | **90 — 85 PASS, 5 FAIL** |
| UI orqali yozilgan moliyaviy operatsiyalar | 1 kurs, 1 zavod kirimi, 3 konsignatsiya (14 dona), 4 skaner savdo, 3 vazn savdo, 3 to‘lov, 3 kassa topshiruvi, 1 bekor qilish, 6 mijoz, 3 sotuvchi kursi |
| Yakuniy rekonsilyatsiya (faqat UI kiritmalaridan) | **26/26 qator, maks. 0.0000 g**, operatsiyalarda expected ≠ actual: 0 |

## Qamrov (talab bo‘yicha)

| Talab | Natija |
|---|---|
| 1. Direktor, menejer, 3 sotuvchi loginlari (+ boshqa tashkilot direktori/sotuvchisi, worker, xodimsiz) | PASS |
| 2. Yangi mijoz (sotuvchi desktop/mobil, menejer → sotuvchi C, double-click → 1 qator) | PASS |
| 2. Mahsulot tarqatish: zavod kirimi 200 g @8% (double-click → 1 kirim, majburiyat +216), barcode konsignatsiya ekrani 3 sotuvchiga | PASS — DB deltalari aynan |
| 2. Skaner savdo (vazn shtrix-kodi → dona → mijoz → ustama → tasdiq, double-click → 1 savdo) + kvitansiya | PASS ×3 (A desktop, B mobil, C desktop) |
| 2. Vazn sotuvi tanlangan donadan (double-click → 1 savdo, aynan o‘sha dona kesildi) | PASS ×3 |
| 3. Nasiya (qarz) — har mijoz qarzi kutilgan qiymatga teng | PASS |
| 3. UZS / USD / LOM to‘lovi | **FAIL (F-UI-1)** forma oldindan to‘ldirilganidek; **PASS** sotuvchi o‘z kursini qo‘lda kiritganda (4.3276 g, 2.0 g, 3.2017 g — aynan) |
| 3. Kassani topshirish (menejer “Qabul Qilish & Chek”) | USD’siz: PASS. USD bor: **FAIL (F-UI-3)** oldindan to‘ldirilganidek; USD kursi qo‘lda kiritilganda PASS — topshirilgan gramm = to‘lovdagi qayd etilgan gramm |
| 4. Sotuvchi kursi (Kassam, double-click → 1 tarix), diapazondan tashqari kurs serverda rad va xabar ko‘rinadi | PASS ×3 |
| 4. Kvitansiya | PASS (skaner savdodan keyin) |
| 4. Bekor qilish (menejer, kunlik jurnal) — savdo reversed, dona sotuvchiga qaytdi, qarz −4.7538 g | PASS |
| 5. Mobil va desktop, refresh, logout (barcha rollar), noto‘g‘ri parol, noma’lum login, anonim → login | PASS |
| 5. Xato holatlari: sotuvchida yo‘q vazn skaneri → ogohlantirish, savdo yo‘q; dona tanlanmagan vazn sotuvi → savdo yo‘q; sotuvchi taqiqlangan 8 URL (desktop+mobil) → sotuvchi zonasida; sotuvchi menyusi aynan 5 bo‘lim | PASS |
| Boshqa tashkilot (B direktori/sotuvchisi) UI’da A mijozlarini ko‘rmaydi; worker va xodimsiz login ma’lumot ko‘rmaydi | PASS |
| 6. Har amaldan keyin gramm, qarz, kassa, ombor solishtiruvi | PASS (26/26, 0.0000 g) |

## Topilmalar

### F-UI-1 (HIGH, funksional) — sotuvchining “To‘lov” oynasi rasmiy kursni yuboradi
- **Qayerda:** `/sales/app/customers` → mijoz → “💰 To‘lov / To‘lov Qabul” (`src/components/sales/CustomerLedgerAndSheetsSection.tsx`).
- **Nima bo‘ladi:** LOM kursi maydoni oxirgi **rasmiy** kurs bilan (`daily_gold_rates`, 900 000) to‘ladi, sotuvchining o‘z kursi (890 000 / 905 000 / 895 000) bilan emas;
  USD kursi CBU API’dan olinadi — staging’da CBU **503 `ERR_CBU_SERVICE_UNAVAILABLE`**, maydon bo‘sh.
- **Dalil:** B (mobil, faqat naqd): server `403 ERR_RATE_MISMATCH: Sizning joriy LOM kursingiz 905000.00 UZS/g. Yuborilgan kurs: 900000` — to‘lov yozilmadi.
  A va C (USD bilan): brauzer “USD kursi kiritilishi shart” bilan to‘xtatdi; oldindan ko‘rsatish `$100 @ 0 = 0.00 g`, jami 2.91 g (server hisoblaydigan 4.3276 g o‘rniga).
  Skrinshotlar: `UIPAY-*-a-prefilled.png`, `UIPAY-*-a-after-submit.png`.
- **Hisobga ta’sir:** yo‘q — server (072) noto‘g‘ri kursni rad etadi; sotuvchi o‘z kursini qo‘lda kiritsa to‘lov aynan to‘g‘ri (`UIPAY-*-b`).
- **Biznesga ta’sir:** sotuvchi kursi rasmiy kursdan farq qilsa, to‘lovni qo‘lda tuzatmasdan qabul qilib bo‘lmaydi; CBU ishlamasa USD to‘lov umuman bloklanadi.
- **Tavsiya:** forma sotuvchi uchun `rpc_get_seller_rates` (o‘z LOM/USD) ni ishlatsin (SellerMobileWorkspace’dagi kabi) yoki kurs yubormasin — server o‘zi qo‘llaydi.
### F-UI-3 (MEDIUM) — kassani qabul qilishda USD kursi majburiy
- “Qabul Qilish & Chek” oynasida USD bo‘lsa “USD Kursi” required; CBU ishlamagani uchun bo‘sh → brauzer yubormaydi. 072 dan beri topshiruv qayd etilgan grammlarda yopiladi, bu kurs hisobga ta’sir qilmaydi.
  Menejer kursni qo‘lda kiritganda grammlar aynan to‘g‘ri (4.3276 / 3.2017 g).
### F-UI-2 (LOW) — naqd UZS maydoni `step="1000"`
- 447 500 so‘m kabi 1000 ga karrali bo‘lmagan summani brauzer qabul qilmaydi (server qabul qiladi). Dalil: `UIPAY-sellerc-desktop-try1-*`.
### O-1 (LOW) — oldingi API auditidan: ustama farqi hisoboti begona sotuvchiga 0 qaytaradi (oqish yo‘q).

## Muvaffaqiyatsiz bo‘lib, qayta bajarilgan qadamlar (yashirilmagan)
1. UI-1 birinchi urinish: konsignatsiya skaner maydoni selektori (model tanlangach placeholder o‘zgaradi) — tashkilot reset, qayta: 8/8.
2. Sotuvchi A urinish 1: desktop’da yashirin mobil karta tugmasi; urinish 2: harness mavjud bo‘lmagan ustunni o‘qidi — **to‘lov yozilmagan** edi; sabab F-UI-1 ekani `ui-pay.js` bilan aniqlandi.
3. Menejer urinish 1: kartochka selektori har safar sotuvchi C kartasini ochdi, USD kursi bo‘sh, jurnal qatori savdo raqami bilan qidirildi (bu ustun yo‘q) — tuzatildi (`ui3b`).
4. Mobil logout: ekrandan tashqaridagi yon menyu tugmasi; “+ Nasiya” oynasi ochiq qolgan holat — toza sahifadan qayta: 4/4 PASS.
5. Sotuvchi C to‘lovi 447 500 so‘m — F-UI-2.

## Tranzaksiya ID’lari (UI orqali yaratilgan)
| Amal | Hujjat | ID |
|---|---|---|
| Kunlik kurs 900 000 | — | `0c650bf7-a861-445a-aa0c-73956532d8fa` |
| Zavod kirimi 200 g | — | `7aaaac1c-3748-4062-b04d-4a98789a8398` |
| Konsignatsiya A / B / C | — | `449ced17-…-25f34c4823bf` / `0b553c80-…-27205b129fdc` / `fadfef46-…-f8bc56cd59b0` |
| Skaner savdo A (5.11 g, urinish 1) | SALE-BC-F20B85D4 | `7d9e400d-cfc4-45d8-b182-6cb0abde16a4` |
| Skaner savdo A (6.23 g) | SALE-BC-DF4CE5C4 | `9d35d0d8-a7dd-4cff-ada1-1a6f8096278b` |
| Vazn savdo A (3 g / 12.53 g dona) | SALE-W-20261103-B5538F | `86b28a0e-fae7-43de-8634-a919b4fed990` |
| To‘lov A (890 000 so‘m + $100 + 1.5 g @750) | SETTL-F7C92AED | `137f6f8f-0c80-4772-92e6-ffbea3d707c5` |
| Skaner savdo B (4.17 g) → keyin bekor qilindi | SALE-BC-72EDCB66 | `18442f06-7f58-4176-a8fc-7fda43173508` |
| Vazn savdo B | SALE-W-20261103-F5176D | `a2746326-eff1-4479-882f-1889ba3432ee` |
| To‘lov B (1 810 000 so‘m) | SETTL-29976A5C | `bccb9dfe-e143-43e8-a9f5-f6b62325f02d` |
| Skaner savdo C (4.61 g) | SALE-BC-3C07589C | `b69e729a-721b-44a6-a30e-f35955a28599` |
| Vazn savdo C | SALE-W-20261103-86EE16 | `121ab08e-9214-45f9-a089-4f4273f791e7` |
| To‘lov C (448 000 so‘m + $50 + 2 g @585) | SETTL-B59417C2 | `7aee375b-a140-45e9-990e-830b8f325543` |
| Topshiruv B / A / C | — | `a3b3715a-…-db21f7ea3721` / `9c8a5138-…-e2324a2a5c85` / `0f1e39bd-…-ea1a17b8b340` |

## Yakuniy rekonsilyatsiya (UI sessiyasi; tashkilot UI-1 dan oldin nolga qaytarilgan)

| Ko‘rsatkich | Kutilgan | Haqiqiy |
|---|---|---|
| Zavod majburiyati / menejer ombori | 216 / 106.74 g | 216 / 106.74 g |
| A: majburiyat / topshirilgan / qarz / qo‘ldagi | 49.381 / 4.3276 / 45.0534 / 28.6 g | aynan |
| B: majburiyat / topshirilgan / qarz / qo‘ldagi | 28.224 / 2 / 26.224 / 22.7 g | aynan |
| C: majburiyat / topshirilgan / qarz / qo‘ldagi | 27.632 / 3.2017 / 24.4303 / 18.51 g | aynan |
| Sotuvchilar kassasi | 0 | 0 |
| Mijozlar qarzi (CUST-0059 / 0060 / 0061 / 0062) | 5.7232 / 6.1 / 0.8 / 4.2076 g | aynan |
| Menejer kassasi | 3 148 000 so‘m / $150 | aynan |
