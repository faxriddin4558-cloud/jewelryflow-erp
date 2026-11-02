# Goldia Sales — 073 release candidate: barqarorlashtirish, moliyaviy audit va release

**Sana:** 2026-11-02 · **Asos:** production `2a70155` (sxema 001–072) + PR #13 (`d3fb20d`)
**Natija:** bitta migratsiya `20260101000073_goldia_release_candidate_stabilization.sql`, bitta PR (#13). **Production o‘zgartirilmadi.**

## 1. Tuzatilgan xatolar va dalillar

| # | Xato | Tuzatish | Dalil (oldin → keyin) |
|---|---|---|---|
| B | Nol-reset sotuvchining 072 valued till pool’ini tozalamagan: resetdan keyin 2.0000 g olingan pul 2.0593 g bo‘lib topshirilgan | Reset `till_valued_*` ni ham nollaydi | 2.0593 → **2.0000 g**; pool resetdan keyin 0; Org B ma’lumotlari o‘zgarmadi; menejer/sotuvchi/noto‘g‘ri kod rad etiladi (`evidence/post-reset-073rc.log`, `reset-org-isolation-073rc.log`, `zero-reset-073rc.log`) |
| A | Toshkent sanasi: 00:00–04:59 oralig‘ida kurs, sotuv va to‘lov oldingi kunga, 1-kun 00:00 dagi sotuv oldingi oy/yilga tushgan | Yagona qoida `public._goldia_business_date()` = Asia/Tashkent kalendar sanasi (sessiya vaqt zonasiga bog‘liq emas). 16 ta RPC, 8 ta hujjat ustuni default’i va frontend’dagi "bugun" (`src/lib/business-date.ts`) shu qoidaga o‘tdi | **Soxta soatli** PostgreSQL (libfaketime), haqiqiy RPC’lar: 072 da **6/14**, 073 da **14/14** — 23:59, 00:00, 00:01, 04:59, 05:00, oy oxiri/boshi, yil oxiri/boshi, oy bo‘yicha taqsimot, kurs tarixi (`bizdate-072.json`, `bizdate-073.json`). Repo skripti: `scripts/verify-073-business-date-local.sh` (073 siz FAIL, 073 bilan PASS) |
| C | Vazn bo‘yicha sotuvda gramm qaysi fizik donadan ayrilishi tasodifiy UUID tartibiga bog‘liq edi | `rpc_record_weight_sale(..., p_piece_ids uuid[])`. Shtrix-kod model kodi va vazndan iborat, individual donani aniqlay olmaydi. Shuning uchun sotuvchida shtrix-kodli dona bo‘lsa-yu, operator donani tanlamasa, sotuv **rad etiladi** (`ERR_PIECE_REQUIRED`). Faqat oxirgi tanlangan dona qisman kesiladi; takror, begona, sotilgan va ortiqcha dona rad etiladi. UI: mavjud formada "Qaysi donadan?" tanlovi | `pieces-073rc.json` **14/14**: aniq dona/gramm/oldingi vazn qayd etiladi; bekor qilish aynan shu donalarni tiklaydi; `held + sold = consigned` har doim; parallel kesish — bittasi o‘tadi, dona manfiyga tushmaydi; shtrix-kodsiz eski partiya avvalgidek ishlaydi. UI: tanlangan 40 g donadan aynan 2 g kesildi (`ui-073rc.json` U6) |

Avvalgi (070) tuzatishlar saqlangan: regressiya **16/16** (ikkala xodim modelida).

## 2. Ochiq qolgan aniq xavflar
1. **Demo Supabase 069 da qolgan.** Mendan uni ko‘tarishning imkoni yo‘q: sessiya tarmog‘i
   `aws-1-eu-west-3.pooler.supabase.com:5432` ni bloklaydi (DNS ham yo‘q), SQL RPC yo‘q. Minimal kerakli ruxsat:
   - yoki muhit sozlamalarida (Network access → Allowed domains) shu host,
   - yoki egasi demo’ga `supabase db push` / SQL editor orqali 070–073 ni o‘zi qo‘llaydi.

   Shu sababli **haqiqiy Auth bilan tranzaksion testlar o‘tkazilmagan**.
2. **Frontend va DB ketma-ketligi.** Yangi frontend `p_piece_ids` yuboradi, eski DB uni bilmaydi. Eski frontend esa 073 dan keyin
   dona tanlamaydi (xavfsiz rad etiladi). DB va frontend deploy oralig‘ida vazn sotuvi qilinmasin (`docs/releases/073-production-release.md`).
3. **Bir xil model+vaznli ikki dona** barcode orqali sotilsa, qaysi biri ekanini kod aniqlamaydi. Ular jismonan almashinuvchan
   (yorliqlar bir xil), shuning uchun moliyaviy farq yo‘q.
4. React hydration ogohlantirishi (#418) — avvaldan ma’lum, LOW; moliyaga ta’siri yo‘q.
5. Sheets historical import va ishlab chiqarish ERP `orders` jadvali UTC `CURRENT_DATE` da qoldi — Goldia Sales doirasidan tashqarida.

## 3. Haqiqiy Supabase Auth brauzer testi
| Tekshiruv | Natija |
|---|---|
| 5 rol (direktor, menejer, sotuvchi A, B, C) haqiqiy GoTrue login, sessiya cookie (`sb-yvvbdoqncubtwlzskgml-auth-token`) | **PASS 5/5** |
| Sotuvchi menyusi aynan 5 bo‘lim | **PASS** |
| Taqiqlangan va eski URL’lar (33) | **PASS 33/33** |
| Refresh / logout / anonim redirect / noto‘g‘ri parol | **PASS** 5/5, 5/5, 4/4 |
| Haqiqiy Auth bilan sahifa ma’lumotlari | 17 ta 404 — demo’da 071/072 RPC’lari yo‘q (muhit farqi) |
| Haqiqiy PostgREST/RLS hujumlari | 34/39 — 5 FAIL aynan demo 069 da bo‘lgani uchun (production’da 070 bilan yopilgan) |
| **Haqiqiy Auth bilan tranzaksiyalar** | **NOT TESTED** (2-bo‘lim, 1-band) |

Audit foydalanuvchilari demo’da yaratilib, test tugagach o‘chirildi; parollar chiqarilmadi.

## 4. Moliyaviy reconciliation (lokal PG16, 073, mustaqil hisob)
Ssenariy (`s073rc.json`) **27/27**. Asosiy kutilgan va haqiqiy qiymatlar (farq 0.0000 g):

| Operatsiya | Kutilgan | Haqiqiy | Farq |
|---|---|---|---|
| Zavod kirimi 500 g @8% | 540 g | 540 | 0 |
| A 200 g @15% / B 100 g @12% | 230 / 112 g | 230 / 112 | 0 |
| Barcode 12.5 g @12% / vazn 40 g @15% (30 g + 10 g, tanlangan donalar) / B 25 g @20% | 14 / 46 / 30 g | 14 / 46 / 30 | 0 |
| A to‘lovi: 4 450 000 so‘m @890 000 + 200 USD @12 500 + 3 g 750-proba lom | 5 + 2.8090 + 3.8462 = 11.6552 | 11.6552 | 0 |
| B to‘lovi: 9 000 000 @900 000 + 100 USD @12 700 | 11.4111 | 11.4111 | 0 |
| A kursi 890 000 → 920 000 dan keyin topshiruv | 21.6552 (qo‘lga kiritilgan grammlar) | 21.6552 | 0 |
| Kompaniya kurs farqi (xarid 2.5 g / 2 000 000 so‘m, pul o‘rtacha kursi 894 000) | +0.262864 | +0.262864 | 0 |
| Ustama farqi −0.375 + 0 + 2.0; B bekor qilingach | +1.625 / −0.375 | +1.625 / −0.375 | 0 |
| To‘langan B sotuvini bekor qilish | 11.4111 g avans | 11.4111 | 0 |
| Afinaj 3.0 g @750 → 2.24 g @999; zavod majburiyati | 3.8252 / 533.6748 | 3.8252 / 533.6748 | 0 |

Mustaqil rekonsilyatsiya (hujjatlardan qayta hisob: fizik balans, sotuvchi zaxirasi, majburiyati va kassasi, mijoz qarzlari, seyf so‘m/USD/lom/afinaj/xarid, zavod): **25/25**, parallel testlardan keyin **26/26**.

## 5. Migratsiya va rollback
- **Raqam:** bitta `073`; PR #13 dagi `..._reset_clears_seller_till_pool.sql` shu faylga birlashtirildi (parallel raqam yo‘q).
- **Toza PG16 da 001–073:** muvaffaqiyatli qo‘llandi. **Mavjud 072 bazadan 073:** muvaffaqiyatli; balanslar va qator sonlari o‘zgarmadi.
- **Qayta ishga tushirish:** imzo o‘zgarmaydi (idempotent).
- **Rollback** (`supabase/rollback/20260101000073_rollback.sql`): 072 → 073 → rollback = 072 imzosi bilan aynan bir xil (funksiya ta’riflari, ACL, policy, trigger); qayta qo‘llash = 073.
- **Postflight** (`supabase/release/073_postflight_readonly.sql`): 073 da **12/12 true**; rollbackdan keyin xato beradi (to‘g‘ri).
- **Release repetitsiyasi** (`scripts/goldia-prod-release.js --migration 073`, 072 + to‘liq ssenariy ma’lumotli bazada): backup, restore-test, compat (+rollback/qayta qo‘llash), zarar skaneri, migratsiya, postflight — **PASS**; balanslar o‘zgarmadi.

## 6. To‘liq test natijalari
| To‘plam | Natija |
|---|---|
| Vitest (PGlite, 001–073) | **331/331** (shu jumladan yangi `goldia-073-release-candidate`, `business-date`) |
| Typecheck, lint, `next build` | PASS |
| 073 regressiya testi 073 siz / 073 bilan | 3/3 FAIL / 3/3 PASS |
| Soxta soatli sana chegarasi (PG16) | 072: 6/14 · 073: 14/14; repo skripti PASS |
| Dona tanlash (PG16) | 14/14 |
| 070 regressiyasi | 16/16 + 16/16 |
| Parallel (PG16): bitta donani ikki marta sotish, birinchi to‘lovlar, bir kalit bilan 2 so‘rov, kassani ikki marta topshirish, ikki marta bekor qilish, parallel kurs o‘zgarishi | 6/6; `verify-weight-sale-concurrency-local.sh` PASS; `verify-acceptance-audit-concurrency-local.sh` PASS |
| Playwright lokal 073 (shim auth) — mobil 390 va desktop 1366 | **34/34** |
| Playwright haqiqiy Supabase Auth (demo, RC frontend) | 83/100 (17 = demo 069) |
| Haqiqiy PostgREST/RLS (demo) | 34/39 (5 = demo 069) |

## 7. Commit va PR
Branch `ccr-fb8951ce-65agfo`, PR #13 (draft, yangilangan) — 6-bo‘limdagi hammasi bitta release candidate ichida.

## 8. Production changed: **NO**

## 9. REAL GOLD: **LIMITED GO** (073 production’ga qo‘llanganidan keyin)
- STOP shartlari lokal muhitda bajarilmadi: gramm farqi 0, konvertatsiya to‘g‘ri, cross-seller oqish yo‘q, noaniq qisman
  sotuv bloklanadi, reset eski pulni aralashtirmaydi, rollback buzilmaydi, demo va production izolyatsiyasi isbotlangan.
- **FULL GO emas:** haqiqiy Supabase Auth bilan tranzaksiyalar demo 069 da qolgani sababli bajarilmagan (NOT TESTED).
  Demo 073 ga ko‘tarilgach shu testlar o‘tishi shart.
- 073 qo‘llanmaguncha production’da: nol-resetni ishlatmang, Toshkent vaqti bilan 00:00–05:00 oralig‘ida operatsiya qilmang.
