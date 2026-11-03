# Goldia Sales — autentifikatsiyalangan yakuniy brauzer va moliyaviy qabul auditi

> **Yangilanish (keyinroq):** bu yerdagi 073 tuzatishi yagona release-candidate migratsiyasiga birlashtirildi —
> `supabase/migrations/20260101000073_goldia_release_candidate_stabilization.sql`, test `src/lib/__tests__/goldia-073-release-candidate.test.ts`.
> Batafsil: `docs/audits/goldia-release-candidate-073/README.md`.


**Sana:** 2026-11-02 · **Kod:** `2a70155` (production `/api/version` tasdiqladi) · **Production sxema:** 001–072 (egasi ma’lumoti)
**Qaror:** **REAL GOLD: LIMITED GO** — shartlar 10-bo‘limda.

> Production DB’ga hech narsa yozilmadi. Barcha yozish operatsiyalari faqat izolyatsiyalangan muhitlarda bajarildi.

## 1. Haqiqatan ishlatilgan loginlar

| Identifikator | Qayerda | Auth turi |
|---|---|---|
| audit.director / audit.manager / audit.sellera / audit.sellerb / audit.sellerc `@goldia-audit.test` | Test Supabase loyiha `yvvbdoqncubtwlzskgml` (DEMO tashkilot) | **Haqiqiy Supabase Auth (GoTrue)**, parol bilan |
| Anonim | Test loyiha + production | haqiqiy anon kalit |
| T Direktor / T Menejer / Sotuvchi A, B, C / nofaol / xodimsiz / boshqa tashkilot | Lokal PostgreSQL 16 (072/073) | lokal JWT shim (**haqiqiy Auth emas**) |

Audit foydalanuvchilari test loyihada service-role admin API orqali yaratildi. Parollar tasodifiy bo‘lib, faqat konteynerdagi
`0600` faylda saqlandi; chatga, loglarga, skrinshotlarga yoki GitHub’ga yozilmadi. Audit tugagach ular test loyihadan
o‘chirildi (`harness/delete-users.js`); qayta sinash uchun `harness/create-users.js` bilan qayta yaratiladi.

## 2. Javoblar

| Savol | Javob |
|---|---|
| Haqiqiy Supabase Auth tekshirildimi? | **HA** — 5 rol, test loyihada (`sb-yvvbdoqncubtwlzskgml-auth-token` cookie) |
| Haqiqiy brauzer tranzaksiyalari (haqiqiy Auth bilan) | **YO‘Q** — test loyiha sxemasi **069**, frontend esa 072 ni kutadi (4-bo‘lim) |
| Brauzer tranzaksiyalari (lokal 072, shim auth) | **HA** — Kassam kursini o‘zgartirish va ko‘rinish tekshiruvlari; to‘liq moliyaviy ssenariy RPC darajasida |
| Production’da yozish | **YO‘Q** |

## 3. Izolyatsiya dalili

- Kalitlar JWT payload’i bo‘yicha: `ref = yvvbdoqncubtwlzskgml`, rollar `service_role` / `anon`. Production ref (`vrozlllcaxinavzxueif`)
  emas. Har bir yozuvchi skript `harness/guard.js` orqali ref’ni tekshiradi va production ref bo‘lsa to‘xtaydi.
- Test loyiha tarkibi (READ-ONLY tekshirildi): 1 tashkilot — "Namuna Zargarlik (DEMO)", 5 ta `@demo.jewelryflow.uz` foydalanuvchi.
- Test frontend build’ida faqat test ref bor (`.next/static` da production ref yo‘q); server `127.0.0.1:3200` da.
- Lokal muhit: PG16, unix socket + `127.0.0.1`, shim faqat `127.0.0.1` ga bog‘langan.
- Production faqat o‘qildi: `/api/version` → `2a70155`, `supabase_ref vrozlllcaxinavzxueif`.

## 4. Haqiqiy Supabase Auth — natijalar (test loyiha, frontend `2a70155`)

**Brauzer (Playwright, desktop 1440/1366/1280 va mobil 390):** 100 tekshiruv — **83 PASS, 17 FAIL**. 17 FAIL’ning hammasi faqat
`404 rpc_get_seller_rates` yoki `404 rpc_get_manager_available_stock_grams`: test loyihada 071/072 yo‘q. Bu muhit farqi,
production xatosi emas.

| Tekshiruv | Natija |
|---|---|
| 5 rolning haqiqiy login’i, sessiya cookie’si | 5/5 PASS |
| Noto‘g‘ri parol rad etiladi, cookie yo‘q | PASS |
| Anonim → himoyalangan sahifalar login’ga | 3/3 PASS |
| Sotuvchi menyusi aynan 5 bo‘lim (Asosiy, Skaner, Mijozlar, Kassam, Ustama farqi) | 3/3 PASS |
| Sotuvchi uchun taqiqlangan va eski URL’lar (`/sales/director`, `/sales/mobile`, `/`, `/dashboard`, factory, cash, reports …) | **33/33 PASS** — sotuvchi zonasida qoladi |
| Refresh’dan keyin sessiya saqlanadi | 5/5 PASS |
| Logout sessiyani tugatadi | 5/5 PASS |

**To‘g‘ridan-to‘g‘ri PostgREST/RLS hujumlari (haqiqiy JWT):** 39 tekshiruv — 34 PASS, 5 FAIL.
5 FAIL — aynan 069 dagi va 070 da tuzatilgan xatolar: sotuvchi rekonsilyatsiya xulosasini, uch bosqichli xulosani va boshqa
sotuvchi donalarini ko‘radi; `p_org_id` orqali boshqa tashkilot foydasini so‘rash mumkin; boshqa sotuvchining eski qarzi ko‘rinadi.
Bu test loyiha 069 da ekanini tasdiqlaydi va 070 topilmalarini **haqiqiy Supabase’da** qayta tasdiqlaydi.
Production 070 bilan bu holatlardan himoyalangan (070 postflight PASS).

## 5. Lokal 072/073 — to‘liq moliyaviy ssenariy (kutilgan = mustaqil hisob)

`harness/s072.js` — **27/27 PASS**, mustaqil rekonsilyatsiya **25/25**.

| # | Operatsiya | Kutilgan | Haqiqiy |
|---|---|---|---|
| 1 | Zavod kirimi 500 g @8% (+ bir xil kalit bilan retry) | majburiyat 540, ombor 500, 1 kirim | ✅ |
| 2 | Menejer → A 200 g, sotuvchi ustamasi 15% | majburiyat 230 | ✅ |
| 3 | Menejer → B 100 g @12% | 112 | ✅ |
| 4 | Barcode sotuv 12.5 g @12% / vazn sotuvi 40 g @15% | 14.0 / 46.0 | ✅ (vazn sotuvi qaysi donadan kesishi tasodifiy — M-7) |
| 5 | B: 25 g @20% | 30.0 | ✅ |
| 6 | Eski qarz 3 g + qisman to‘lov | qoldiq 17 − 11.6552 = 5.3448 | ✅ |
| 7–8 | Kurslar: A LOM 890 000 / USD 12 500; B 900 000 / 12 700; ±25% dan tashqari kurs; menejer sotuvchi kursi RPC’sidan foydalanishi | saqlanadi / rad / rad | ✅ |
| 9 | A: 4 450 000 so‘m + 200 USD + 3.0 g 750 lom | 5.0 + 2.8090 + 3.8462 = 11.6552 | ✅; brauzer yuborgan boshqa kurs → `ERR_RATE_MISMATCH` |
| 9 | B: 9 000 000 so‘m + 100 USD | 10 + 1.4111 = 11.4111 | ✅ |
| 10 | A kursini 890 000 → 920 000 ga o‘zgartirib, keyin topshiradi | qo‘lga kiritilgan grammlar 21.6552, gramm yaratilmaydi ham, yo‘qolmaydi ham | ✅ |
| 10 | A sotuvchi B kassasini topshirishi | rad | ✅ |
| 11–12 | 2 000 000 so‘mga 2.5 g xarid; pul o‘rtacha kursi 894 000 | kurs farqi +0.262864 g | ✅ |
| 13 | Ishorali ustama farqi: −0.375 + 0 + 2.0 | +1.625; B sotuvi bekor qilingach −0.375 | ✅ |
| 15 | To‘langan B sotuvini bekor qilish | 11.4111 g avans; ikkinchi marta bekor qilish rad | ✅ |
| 15 | "100 g" donani qaytarish | majburiyat dona vazni × 1.15 ga kamayadi | ✅ |
| 14 | Afinaj 3.0 g @750 → 2.24 g @999 | chiqish 3.8252, yo‘qotish 0.0210 | ✅ |
| 14 | Zavodga afinaj + xarid oltini | majburiyat 540 − 3.8252 − 2.5 = 533.6748 | ✅ |
| 16 | Nol-reset (faqat lokal) | faqat direktor + kod; hamma balans 0 | ✅, lekin **F-073** (6-bo‘lim) |
| S1–S3 | Sotuvchi B kurslari, tarixi, limitlari, kompaniya zaxirasi; xodimsiz/anonim | rad | ✅ |

**Lokal brauzer (072, shim auth):** 16 tekshiruvdan 15 PASS:
- Kassam sahifasi sotuvchining o‘z kursini ko‘rsatadi; UI orqali o‘zgartirish (ikki marta bosilsa ham bitta tarix yozuvi) ishlaydi.
- 5 000 000 kursi server tomonidan rad etiladi va xato foydalanuvchiga ko‘rsatiladi.
- A sotuvchi B ning kursini ko‘rmaydi, menejer ikkalasini ko‘radi.
- Kurs o‘zgargandan keyin eski to‘lov 900 000 / 12 700 snapshotini saqlaydi.
- 1 ta FAIL (K9) xato emas: bazada boshlang‘ich hisob (baseline) yo‘q, shuning uchun foyda kartasi chiqmaydi.

## 6. Tasdiqlangan topilma

### F-073 — nol-reset sotuvchining 072 kassa pulini tozalamaydi (MEDIUM; reset ishlatilsa HIGH)
- **Qayta tiklash:** 072 ssenariysi → `rpc_execute_full_test_reset` → yangi kirim/sotuv → sotuvchi 1 840 000 so‘m oladi
  (920 000 kursida 2.0 g) → topshiruv.
- **Kutilgan:** 2.0 g. **Haqiqiy:** **2.0593 g** — eski pul (13 350 000 so‘m / 15 g) aralashib, 0.0593 g yaratildi.
- **Ildiz sababi:** reset `seller_till_*` ni nollaydi, lekin 072 dagi `till_valued_*` ustunlarini nollamaydi. Bundan tashqari
  bekor qilingan topshiruvlar 072 triggeri orqali grammlarni pulga qaytaradi.
- **Production ta’siri:** 072 dan keyin production’da reset ishlatilmagan bo‘lsa — hozircha zarar yo‘q; keyingi har qanday reset
  sotuvchi topshiruvlarini buzadi.
- **Tuzatish:** `supabase/migrations/20260101000073_goldia_reset_clears_seller_till_pool.sql` — faqat reset funksiyasi
  o‘zgaradi, ma’lumot o‘zgarmaydi.
  - Rollback: `supabase/rollback/20260101000073_rollback.sql` (imzo bo‘yicha 072 → 073 → rollback = 072, PASS).
  - Postflight: `supabase/release/073_postflight_readonly.sql`; release skriptida `--migration 073`.
  - Regressiya testi: `src/lib/__tests__/goldia-073-reset-till-pool.test.ts` — 073 bilan PASS, 073 siz FAIL.
  - Tuzatilgandan keyin topshiruv aynan 2.0 g.

### Qayta tasdiqlangan, ochiq qolgan masalalar
- **M-7:** vazn sotuvida qaysi donadan kesilishi tasodifiy UUID tartibiga bog‘liq — shtrix-kod yorliqlari tizimdagi vazndan
  ajralib ketadi.
- **M-14:** UTC va Toshkent sanasi farqi. Toshkent vaqti bilan 00:00–05:00 orasida kurs va sotuv oldingi kunga yoziladi.
- Test loyiha (`yvvbdoqncubtwlzskgml`) **069 sxemasida** — u production bilan bir xil emas va yozish testlari uchun yaroqsiz.

## 7. Testlar

| To‘plam | Natija |
|---|---|
| Vitest (PGlite, 001–073) | **315/315** |
| Typecheck, lint | PASS |
| Lokal PG16 regressiya (070 F1–F11), ikki xodim modelida | 16/16, 16/16 |
| 072 ssenariysi + rekonsilyatsiya | 27/27, 25/25 |
| Haqiqiy Auth brauzer | 83/100 (17 = test loyihada 071/072 yo‘q) |
| Haqiqiy PostgREST xavfsizlik | 34/39 (5 = test loyiha 069, production’da 070 bilan tuzatilgan) |
| Lokal 072 brauzer (Kassam) | 15/16 (1 = baseline yo‘q) |

## 8. Sinalmagan narsalar

- **Haqiqiy Auth bilan brauzer tranzaksiyalari.** Test loyiha 069 da, uni 072/073 ga ko‘tarish uchun DB ulanishi yoki SQL RPC yo‘q
  (sandbox’da faqat HTTPS bor, pooler DNS ishlamaydi). Kerakli amal: egasi test loyihaga 070–073 ni qo‘llaydi, shundan keyin
  `harness/browser.js` + tranzaksion ssenariy haqiqiy Auth bilan qayta ishga tushiriladi.
- **Production’da autentifikatsiyalangan READ-ONLY rol tekshiruvi** — production test identifikatorlari berilmagan.
- **Token muddati tugashi (haqiqiy GoTrue bilan), Telegram login, PWA o‘rnatish, kvitansiyani qog‘ozga chop etish.**
- **Haqiqiy Supabase’dagi parallel so‘rovlar.** Ular faqat lokal PG16 da sinalgan (oldingi audit: C1–C8, F3).

## 9. Kerakli tuzatishlar, commit va PR

- Branch `ccr-fb8951ce-65agfo` (`2a70155` dan): 073 migratsiyasi, rollback, postflight, regressiya testi va ushbu hisobot.
- Draft PR — **merge va deploy qilinmagan**. Production’ga 073 ni qo‘llash uchun: `node scripts/goldia-prod-release.js --migration 073`
  (backup → restore-test → compat → bitta tranzaksiya → postflight).

## 10. Qaror: **REAL GOLD — LIMITED GO**

Asoslar:
- haqiqiy Supabase Auth bilan barcha 5 rol login, sessiya va marshrut nazorati tasdiqlandi;
- 072 moliyaviy logikasi (sotuvchi kurslari, qo‘lga kiritilgan grammlar, kurs farqi, ustama farqi, bekor qilish) mustaqil hisob
  bilan to‘liq mos;
- production’da 070 xavfsizlik tuzatishlari ishlayapti.

Cheklovlar va shartlar:
1. 073 production’ga qo‘llanmaguncha **production’da nol-resetni ishlatmang**.
2. Toshkent vaqti bilan 00:00–05:00 orasida operatsiya qilmang (M-14).
3. Haqiqiy Auth bilan tranzaksion brauzer testi 072/073 dagi test loyihada qayta o‘tkazilishi kerak — u o‘tmaguncha **FULL GO yo‘q**.
4. Birinchi hafta: kunlik zarar skaneri (`070_damage_scan_readonly.sql`) va menejerning jismoniy sanog‘i.
