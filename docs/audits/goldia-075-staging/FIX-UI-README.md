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

## Staging, 1-raund (frontend `9086a74`, 2026-11-04) — 13/15
`evidence/ui-fix-verify-staging-9086a74.json`, skrinshotlar `evidence/ui-fix-screens-staging-9086a74/`.
- **PASS 13:** F-UI-1 uchala sotuvchida (A desktop 4.3276 g, B mobil 2 g, C desktop 3.2011 g — forma oldindan to‘ldirilganidek, o‘z kursi, read-only), F-UI-2 (447 500 so‘m), uchala kassa qabuli (topshirilgan gramm = to‘lovdagi gramm), server himoyasi (SRV-1/2), rekonsilyatsiya 22/22, **0.0000 g**.
- **FAIL 2 (F3-prefill A va C):** kassa qabuli oynasi ochilganda USD kurs maydoni 2.5 s ichida **bo‘sh**. Sabab: kod sotuvchi kursini CBU javobi bilan birga kutgan; staging CBU endpoint’i **6.4 s** dan keyin 503 qaytaradi. Qabul baribir to‘g‘ri o‘tdi (maydon majburiy emas edi).
- Lokal takrorlash (`GA_SLOW_CBU=1`, CBU 6.5 s → 503) 9086a74 build’ida: 13/16 — o‘sha 2 FAIL + **menejer to‘lov oynasida rasmiy kurs ham kechikadi (MGR-prefill)** — 9086a74 keltirgan regressiya (`evidence/ui-fix-verify-local-slowcbu-9086a74.json`).

## 2-tuzatish: saqlangan kurslar CBU’ni kutmaydi
To‘lov oynasi (barcha rollar) va kassa qabuli oynasi saqlangan kurslarni darhol to‘ldiradi; CBU faqat keyin, faqat bo‘sh maydon uchun (menejer/direktor USD, yoki sotuvchida saqlangan USD kursi bo‘lmasa).
Lokal: sekin CBU bilan **16/16**, oddiy **16/16** (`ui-fix-verify-local-slowcbu-fixed.json`, `ui-fix-verify-local.json`); vitest 355/355; sahifalar regressiyasi 36/36.
