# F-UI-1 / F-UI-2 / F-UI-3 — minimal frontend fix (no SQL, no server change)

| Topilma | Tuzatish | Fayl |
|---|---|---|
| **F-UI-1 (HIGH)** sotuvchi to‘lov oynasi rasmiy kursni (900 000) va CBU USD kursini (503 → bo‘sh) yuborardi | Sotuvchi oynani ochganda LOM va USD kursi **serverda saqlangan o‘z kursidan** (`rpc_get_seller_rates`) to‘ladi, maydonlar read-only; CBU sotuvchi uchun ishlatilmaydi. Direktor/menejer xatti-harakati o‘zgarmagan. O‘z USD kursi bo‘lmasa — “Kassam’da USD kursingizni belgilang” | `src/components/sales/CustomerLedgerAndSheetsSection.tsx`, `src/lib/sales-payment-rates.ts` |
| **F-UI-3 (MEDIUM)** kassa qabulida USD kursi majburiy va bo‘sh | Kurs sotuvchining saqlangan USD kursi bilan to‘ladi (keyin CBU); 072 dan keyin olingan dollar to‘lov vaqtida qiymatlangan grammda yopiladi — oynada shu gramm ko‘rsatiladi, kurs faqat qiymatlanmagan (072 dan oldingi) dollar uchun majburiy | `src/components/sales/DirectorSalesWorkspace.tsx` |
| **F-UI-2 (LOW)** UZS summa `step="1000"` | UZS **summa** maydonlari `step="1"` (to‘lov, kassa qabuli, xarid, eski mobil to‘lov); kurs maydonlari o‘zgarmagan | o‘sha fayllar + `SellerMobileWorkspace.tsx` |

Server: `ERR_RATE_MISMATCH` himoyasi, formulalar, migratsiyalar — **o‘zgarmagan** (testda tekshirildi: SRV-1, SRV-2).

## Testlar
| | Natija |
|---|---|
| `src/lib/__tests__/sales-payment-rates.test.ts` (yangi) | 9/9 |
| Butun vitest | **355/355** |
| `tsc --noEmit`, eslint (o‘zgargan fayllar) | toza |
| **Playwright, lokal stend** (PG17 + haqiqiy GoTrue + PostgREST, migratsiya 075, tuzatilgan build) — `harness/ui-fix-verify.js` | **15/15**: 5 ta oldingi FAIL ssenariysi endi forma **oldindan to‘ldirilganidek** o‘tadi (A desktop: 4.3276 g; B mobil: 2 g; C desktop 447 500 so‘m + $50 + 2 g: 3.2011 g; A va C kassasi qabulida USD kursi to‘la va majburiy emas, topshirilgan gramm = to‘lovdagi gramm); 447 500 so‘m qabul qilindi; rekonsilyatsiya 17/17, **0.0000 g** — `evidence/ui-fix-verify-local.json` |
| Regressiya, lokal: mijoz yaratish UI (A) / sahifalar + vazn sotuvi UI | 11/11 / 36/36 — `evidence/fix-regression-local/` |

Regressiya urinishlaridagi yashirilmagan qadamlar: birinchi lokal A-run 7/11 (tekshiruv skripti o‘sha tashkilotda oldin 3 mijoz yaratgani uchun kodlar 0004 dan boshlandi — test tartibi; yangi stend, tartib o‘zgartirildi → 11/11);
birinchi `ui-pages` 35/36 (yangi stendda sotuvchi A da dona yo‘q edi, U4 sharti; dona berilgach → 36/36).

## Staging
Tuzatilgan frontend hali staging’da emas (deploy egasi tomonidan). Deploy’dan keyin aynan shu skript staging’da ishlaydi:
`GA_TARGET=staging GA_CREDS=<staging creds> node docs/audits/goldia-075-staging/harness/ui-fix-verify.js` (yangi vaqtinchalik staging loginlari kerak — eskilari bloklangan).
