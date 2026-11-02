# Goldia Sales — mustaqil yakuniy qabul auditi (real biznes jarayonlari bo‘yicha)

**Sana:** 2026-11-01 · **Auditor:** Claude (mustaqil QA / moliyaviy audit / xavfsizlik)
**Yakuniy qaror:** **CONTROLLED PILOT GO — faqat 070-migratsiya production’ga qo‘llanganidan keyin.**
069 holatidagi production uchun qaror: **NO-GO (real oltin bilan).** Batafsil — 12-bo‘lim.

> Production’ga hech qanday yozish, migratsiya, reset yoki foydalanuvchi o‘zgartirish **qilinmadi**.
> Bu sessiyada production kalitlari umuman yo‘q edi; barcha sinovlar izolyatsiyalangan bir martalik
> PostgreSQL 16 muhitida sintetik ma’lumotlar bilan bajarildi.

---

## 1. Sinovdan o‘tgan kod va baza versiyasi

| Narsa | Qiymat | Qanday tekshirildi |
|---|---|---|
| Production branch | `feature/jewelryflow-sales-mvp` | `git fetch origin feature/jewelryflow-sales-mvp` |
| Commit | `23ad52090043b6cbf47230d245f7e03c498d7873` (`23ad520`) | `git rev-parse` — ish branch’i bilan bir xil |
| Migratsiyalar | 001 … 069 (69 fayl), oxirgisi `20260101000069_goldia_security_hotfix_anon_rpcs.sql` | toza PG16 ga ketma-ket qo‘llandi, xatosiz |
| Yangi tuzatish | `20260101000070_goldia_acceptance_audit_fixes.sql` | shu audit natijasi (9-bo‘lim) |
| Production loyiha | `vrozlllcaxinavzxueif` (topshiriqda) | **ulanilmadi**. Eslatma: `env.production.example` faylida ref `vrozlilcaxinavzxueif` deb yozilgan — bitta harf farq qiladi, operatorlar tekshirib qo‘ysin |

Production’ning haqiqiy holati (qaysi migratsiyalar qo‘llangani, tashkilotlar soni, `currency_rates`
jadvali bor-yo‘qligi, ochiq ro‘yxatdan o‘tish yoqilganmi) **mustaqil tekshirilmadi** — kalitlar yo‘q
va qoidaga ko‘ra production faqat o‘qish uchun. Topshiriqdagi "069 qo‘llangan" ma’lumoti qabul qilindi.

## 2. Test muhitining izolyatsiyasi (dalillar)

- **Baza:** lokal PostgreSQL 16, `/opt/goldia-audit/pg` (unix-socket) + `127.0.0.1:55432`. Supabase
  rollari (`anon`, `authenticated`, `service_role`, `authenticator`), `auth.uid()/role()/jwt()` va
  Supabase’ning standart `ALTER DEFAULT PRIVILEGES` (anon/authenticated ga hamma narsa) aynan
  hosted Supabase’dagidek qayta yaratildi — 069 dagi `REVOKE` lar real sharoitda sinaldi.
  Skript: `harness/setup.sh`.
- **API:** tashqi binar yuklab olish (PostgREST) sessiya siyosati tomonidan rad etildi, shuning uchun
  `harness/shim.js` yozildi — Supabase-mos minimal shlyuz: `/auth/v1` (bcrypt parol, HS256 JWT, refresh),
  `/rest/v1` (PostgREST so‘rov to‘plami: embed, filter, order, single, RPC). Har bir so‘rov alohida
  tranzaksiyada `SET LOCAL ROLE anon|authenticated` + `request.jwt.claims` bilan bajariladi — RLS va
  `SECURITY DEFINER` tekshiruvlari haqiqiy rol kontekstida ishlaydi. Faqat `127.0.0.1` ga bog‘langan.
- **Ilova:** `next build` + `next start` (`127.0.0.1:3100`), `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`.
  Bundle’da production URL yo‘q (faqat `placeholder.supabase.co` va host allowlist).
- **Muhit o‘zgaruvchilari:** sessiyada hech qanday `SUPABASE_*`/`DATABASE_URL` yo‘q edi.
  `harness/t/lib.js` lokal bo‘lmagan hostga ulanishni rad etadi.
- **Brauzer tarmog‘i:** Playwright har bir so‘rov hostini yozib oldi — faqat `127.0.0.1`, `localhost`
  va `cbu.uz` (Markaziy bank kursi, ochiq API; sandbox tomonidan bloklangan). Supabase/production
  hostlariga **birorta ham so‘rov yo‘q** (`evidence/browser-explore-070.log`, `*-HOSTS` qatorlari).
- **Foydalanuvchilar:** faqat sintetik (`*@audit.test`), parol faqat lokal (`Audit-Local-Only-1`),
  real xodim parollari ishlatilmadi. Mijozlar — "Mijoz A1 (sintetik)" va h.k., telefonlar `+0000…`.

## 3. Haqiqatan tizimga kirgan va sinalgan rollar

| Identifikator | Rol (employees) | DB/RLS sessiyasi | Brauzer login |
|---|---|---|---|
| T Direktor | `admin` / `director` | ✅ | ✅ desktop 1440×900 |
| T Menejer | `production_manager` | ✅ | ✅ desktop 1366×860 |
| Sotuvchi A | `sales` / `seller` | ✅ | ✅ mobil 390×844 (touch) |
| Sotuvchi B | `sales` / `seller` | ✅ | — (DB/RPC orqali) |
| Sotuvchi C | `sales` / `seller` | ✅ | — (DB/RPC orqali) |
| Ruxsatsiz sotuvchi | `sales`, `is_active=false` | ✅ | — |
| Xodimsiz auth foydalanuvchi | yo‘q | ✅ | — |
| Tashkilotsiz xodim | `organization_id = null` | ✅ | — |
| Boshqa tashkilot direktori | `admin`, Org B | ✅ | — |
| Anonim | `anon` | ✅ | ✅ (login sahifasi, redirect) |

Barcha ssenariylar ikki xil xodim modelida takrorlandi: `employees.id = user_id` (production API shu
tarzda yaratadi) va `employees.id ≠ user_id` (eski/import qilingan xodimlar) — `evidence/after-070-idneuser/`.

## 4. Brauzer testlari

`harness/ui/explore.js`, `interact.js`, `logout.js`, `shots.js`, `expiry.js` (Playwright + Chromium).

| To‘plam | Natija |
|---|---|
| Sahifalarni ochish: 3 rol × 17 sahifa + anonim + refresh + host tekshiruvi (63 tekshiruv) | 52 PASS, 11 FAIL (quyida) |
| Interaktiv (mobil to‘lov formasi, double-click, refresh, skaner sotuv, dropdown izolyatsiyasi, logout) | 6 PASS, 1 test-skript xatosi (alohida logout testi PASS) |
| Sessiya muddati tugashi (15 s token) | **Aniq natija yo‘q** — reload’da login’ga qaytdi; bu shim’ning refresh oqimi bilan bog‘liq bo‘lishi mumkin, real GoTrue’da qayta sinash kerak |

11 FAIL ning tarkibi (moliyaviy xato emas): `cbu.uz` ga tashqi so‘rov (sandbox bloklagan) — 5;
React hydration xatosi #418 `/sales/director` va `/sales/mobile` da — 5; sotuvchi `/sales/director`
sahifasini ocha oladi (server 403 bilan ma’lumotni beradi emas) — 1.

UI orqali haqiqiy operatsiyalar va DB tasdig‘i:
- Sotuvchi A mobil "To‘lov olish": 2.0 g 750-proba lom + 100 000 so‘m → mijoz qarzi **3.6132 → 0.9491 g**
  (kutilgan 0.9491), tugma **ikki marta bosilganda ham faqat 1 ta** to‘lov yozildi.
- Refresh’dan keyin kassa 100 000 so‘m va 2.56 g (2.00 g fizik) lom ko‘rsatildi.
- Skaner: "7.65" vazn shtrix-kodi → ZN-03 dona topildi → 1 ta sotuv, 7.65 g, 12% → 8.568 g.
- Sotuvchi dropdown’larida boshqa sotuvchilarning mijozlari yo‘q.
- Logout cookie’larni tozalaydi, himoyalangan sahifa login’ga yo‘naltiradi (sotuvchi va direktor).
- Anonim `/sales/app` va `/sales/mobile` → login; noto‘g‘ri parol → xato xabari.

Skrinshotlar: `evidence/screens/` (oldin/keyin dashboard, mobil, to‘lov formasi, skaner).

## 5. PostgreSQL / RLS / RPC testlari

| To‘plam | Hajm | Natija |
|---|---|---|
| To‘liq biznes ssenariysi (S1–S16 + C1–C8), 069 bazada | 128 qadam | 4 ta moliyaviy buzilish (6-bo‘lim) |
| Xuddi shu ssenariy, 070 bazada | 127 qadam | kutilgan natijalar |
| Mustaqil rekonsilyatsiya (hujjatlardan qayta hisob) | 45 tekshiruv × 3 ishga tushirish | 069: **4 FAIL**, 070: **0 FAIL**, 070 (id≠user_id): **0 FAIL** |
| RLS ko‘rinish matritsasi (23 jadval × 9 identifikator) | 207 katak | cross-tenant oqishlar topildi → 070 da yopildi |
| SECURITY DEFINER sweep (har bir funksiya NULL argumentlar bilan, 5 past huquqli identifikator, har biri ROLLBACK) | 108 funksiya, 540 chaqiruv | anon uchun ochiq `rpc_*` yo‘q; topilmalar 8-bo‘limda |
| Parallel hujumlar (bir dona 2 marta sotish, birinchi to‘lovlar, bir kalit bilan 2 so‘rov, kassani 2 marta topshirish, 2 marta bekor qilish, retry) | 6 holat | 2 ta xato (F3, F7) → 070 da tuzatildi |
| 070 regressiya to‘plami (PG16) | 16 test | 069: **1/16**, 070: **16/16**, 070 id≠user_id: **16/16** |
| Repo vitest (PGlite, barcha migratsiyalar) | 292 test (yangi 9 ta bilan) | hammasi o‘tdi (2 fayl og‘ir yuklamada hook-timeout berdi, alohida qayta ishga tushirilganda o‘tdi) |
| `scripts/verify-weight-sale-concurrency-local.sh` | 1 | PASS |
| `scripts/verify-acceptance-audit-concurrency-local.sh` (yangi) | 1 | 069: FAIL (1.0 g), 070: PASS (3.0 g) |
| Nol-reset (faqat bir martalik bazada) | 1 | faqat direktor + to‘g‘ri kod; menejer/sotuvchi/noto‘g‘ri kod rad etildi; balanslar 0, hujjatlar `reversed/cancelled`, keyingi operatsiyalar noldan boshlanadi |

## 6. To‘liq tranzaksiya ssenariysi — kutilgan va haqiqiy balanslar

Zanjir: ZAVOD → MENEJER → SOTUVCHI → MIJOZ → NAQD/LOM → MENEJER → AFINAJ → ZAVOD. Barcha "kutilgan"
qiymatlar qo‘lda hisoblangan; "haqiqiy" — DB va RPC javoblari (`evidence/after-070/s*.log`).

| # | Operatsiya | Kutilgan | Haqiqiy |
|---|---|---|---|
| S2 | Zavod kirimi 100 g @8%, 50 g @6%, 20 g @10% | fizik 170 g, majburiyat 108+53+22 = **183 g** | 170 / 183 ✅ |
| S2 | Kirimni bir xil idempotency kaliti bilan qayta yuborish | 1 ta kirim | **069: 2 ta kirim, majburiyat 291 g ❌** · 070: 1 ta ✅ |
| S3 | Sotuvchi A ga 4 dona (3.25+5.10+7.65+12.00 = 28 g), sotuvchi ustamasi 12% | majburiyat 31.36 g | 31.36 ✅ (dona: 3.64/5.712/8.568/13.44) |
| S3 | B ga 20 g @10%, C ga 10 g @15% | 22.0 g, 11.5 g | ✅ |
| S3 | R3 da 10 g qolganda 11 g berish | rad | rad ✅ |
| S5 | A: UZ-01 3.25 g, mijoz ustamasi 10% | 3.575 g qarz | ✅ (ustama farqi −0.065 g) |
| S5 | A: vazn bo‘yicha 9.0 g @15% | 10.35 g | ✅ (ustama farqi +0.27 g) |
| S5 | B: ZN-03 9.0 g @10% | 9.9 g | ✅ |
| S5 | O‘sha donani qayta sotish / B donasini A sotishi / 100 g (zaxiradan ko‘p) / ustama 150% / null / manfiy vazn | rad | barchasi rad ✅ |
| S6 | CA1: 4.0 g 500-proba lom + 150 000 so‘m @950 000 | 3.4188 + 0.1579 = 3.5767 → qarz 0, avans 0.0017 | ✅ |
| S6 | CA2: 500 USD @12 800 | 6 400 000/950 000 = 6.7368 → qarz 3.6132 | ✅ (069 da mijoz hisobida USD jami 0 qolardi — 070 da 500) |
| S6 | Sotuvchi o‘z kursi (1 200 000) bilan to‘lov olishi | rad (ERR_RATE_MISMATCH) | ✅ |
| S7 | Kurs 1 000 000 ga o‘zgardi; A: lom 3.4188 + 150 000 + 500 USD topshiradi | 3.4188 + 0.15 + 6.40 = 9.9688; qoldiq 31.36 − 9.9688 = **21.3912** | ✅ (kurs o‘zgarishidan sotuvchi 0.3447 g yo‘qotadi — M-5) |
| S9 | Menejer 3.0 g 750 lomni 2 700 000 so‘mga oldi | 3.8462 g 585-ekv.; kurs farqi +1.0084 g (pul puli o‘rtacha 951 456) | ✅ |
| S9 | 200 USD @12 900 ga 2.0 g 585 | kurs farqi −0.56 g | ✅ |
| S10 | Afinaj 4.0 g @500 → 1.98 g @999 | kirish 3.4188, chiqish 3.3812, yo‘qotish 0.0376 g (1.1%) | ✅ |
| S11 | Zavodga afinaj 3.3812 + xarid 3.8462 = 7.2274 g | majburiyat 183 − 7.2274 = **175.7726** | ✅ |
| S8 | A o‘zi SR-02 (5.10 g) ni menejerga qaytaradi | majburiyat −5.712 | ✅ (ammo nazorat masalasi — M-4) |
| S12 | To‘liq to‘langan UZ-01 sotuvini bekor qilish | mijozda 3.5767 g avans | **069: avans 0.0017, to‘lov yo‘qoldi ❌** · 070 ✅ |
| S12 | 2 marta bekor qilish, menejer pulni sarflagandan keyin topshiruvni bekor qilish | rad | ✅ |
| S13 | C: 11 g vazn sotuvi, keyin qisman ishlatilgan partiyani butunicha sotish (ustama 200%) | rad | **069: qabul qilindi, 15 g zaxiradan 16 g sotildi ❌** · 070 rad ✅ |
| S14 | Kapital 10 000 000 so‘m (USD kursi kiritilmagan, UI odatiy holati) | qabul | **069: `relation currency_rates does not exist` ❌** · 070 ✅ |
| S14 | 0.5 g xarajat | davr natijasi −0.5 g | **069: 0 (xarajat qayta qo‘shilgan) ❌** · 070 −0.5 ✅ |
| S15 | Eski qarz 2.5 g (CA1, sotuvchi A, 2026-09-30 sanasi bilan) | mijoz avansini yutadi, foydaga ta’sir qilmaydi | ✅ |
| S16 | B: 4.4 g @12% | foyda +0.528 g | ✅ |
| C1 | Bir donani 2 sessiya bir vaqtda sotadi | 1 OK, 1 rad | ✅ |
| C3 | Yangi mijozga 3 ta parallel 1 000 000 so‘m to‘lov | avans 3.0 g | **069: 1.0 g (2 g yo‘qoldi) ❌** · 070 ✅ |
| C4/C5/C7 | Kassani 2 marta topshirish / bir kalit bilan 2 so‘rov / 2 marta bekor qilish | bittasi o‘tadi | ✅ |
| C8 | Barcha zaxirani vazn bo‘yicha sotish, so‘ng bir xil kalit bilan retry | asl javob | **069: ERR_INSUFFICIENT_SELLER_STOCK ❌** · 070 ✅ |

**Yakuniy holat (070, `evidence/after-070/state.log`):** zavod kirimi 170 g = menejer 112.1 + sotuvchilarda 17.9
+ sotilgan 40.0 + zavodga qaytgan 0 ✅; zavod majburiyati 175.7726 g; menejer seyfi 23 710 000 so‘m, 300 USD,
2.0 g xarid oltini; sotuvchilar qarzi A 18.1792 / B 13.99 / C 17.1 g; mijozlar qarzlari hujjatlar bilan 100% mos.

## 7. Dalillar

- `evidence/before-069/` va `evidence/after-070/` — har bir qadamning JSON javoblari (`s1…s13.log`, `conc.log`),
  yakuniy holat (`state.log`), RLS matritsasi, SD sweep, rekonsilyatsiya (`recon.json`).
- `evidence/after-070-idneuser/` — `employees.id ≠ user_id` modelida takror.
- `evidence/regression-before-069.*`, `regression-after-070.*`, `regression-after-070-idneuser.json`.
- `evidence/browser-explore-070.log`, `browser-interact-070.log`, `evidence/screens/*.png`.
- `evidence/vitest-full.log`, `evidence/zero-reset.log`.
- Muhit va skriptlar: `harness/` (qayta ishga tushirish: `setup.sh` → `psql -f seed.sql` → `run-scenario.sh <label>`).

Dashboard dalili (069): `screens/before-069-director_sales_app.png` — "⚠️ NOMUVOFIQLIK: 1.00 g", foyda **+3.19 g**;
xuddi shu bazada menejer **−2.39 g** ko‘rgan (`before-069-manager_sales_app.png`) — sababi 8-bo‘limdagi M-13.
070 dan keyin: ikkalasi ham **−0.31 g**, "BALANS TO‘LIQ MOS" (`after-070-*`).

## 8. Tasdiqlangan topilmalar

Batafsil (qayta tiklash qadamlari, kutilgan/haqiqiy, moliyaviy ta’sir, ildiz sababi, dalil): **[FINDINGS.md](FINDINGS.md)**.

| ID | Daraja | Qisqacha | Holat |
|---|---|---|---|
| F1 | **HIGH** (ochiq ro‘yxatdan o‘tish yoqilgan bo‘lsa BLOCKER) | `rpc_get_accounting_profit_summary(p_org_id)` istalgan auth foydalanuvchiga (xodimsiz, nofaol, boshqa tashkilot) istalgan tashkilotning to‘liq balansini beradi | 070 da tuzatildi |
| F1b | **HIGH** | Foyda sarlavhasi xarajatlarni qayta qo‘shadi — kompaniya foydasi xarajatlar summasiga oshirib ko‘rsatiladi | 070 |
| F2 | **HIGH** | To‘langan sotuvni bekor qilish mijoz to‘lovini o‘chirib yuboradi | 070 |
| F3 | **HIGH** | Yangi mijozga parallel to‘lovlar bir-birini yozib yuboradi (avans yo‘qoladi) | 070 |
| F4 | **HIGH** | `rpc_record_client_jewelry_sale` vazn sotuvidan keyin partiyani qayta sotadi (oversell), ustama cheklanmagan | 070 |
| F5 | **HIGH** | Zavod kirimi idempotency kaliti saqlanmaydi → retry majburiyatni ikki baravar qiladi | 070 |
| F6 | **HIGH** | `currency_rates` jadvali hech bir migratsiyada yo‘q → USD kursisiz kapital/xarajat yozib bo‘lmaydi | 070 |
| F9 | **HIGH** | Tashkilotlararo: boshqa tashkilot direktori Goldia xodimlarini o‘zgartiradi/o‘chiradi; xodim o‘z `organization_id` sini o‘zgartiradi | 070 |
| F7 | MEDIUM | Vazn sotuvi retry’i muvaffaqiyatli sotuvni xato deb qaytaradi | 070 |
| F8 | MEDIUM | Sotuvchi kompaniya bo‘yicha jami balanslarni va boshqa sotuvchi donalarini ko‘radi | 070 |
| F10 | MEDIUM | `rpc_set_daily_gold_rate` `set_by` ga `auth.uid()` yozadi → `id≠user_id` direktor kursni o‘rnata olmaydi | 070 |
| M-1…M-13, L-1…L-11 | MEDIUM / LOW | FINDINGS.md da | tuzatilmadi (dizayn/ruxsat talab qiladi) |

## 9. Tuzatishlar

- Migratsiya: `supabase/migrations/20260101000070_goldia_acceptance_audit_fixes.sql` — faqat funksiya tanalari
  va RLS siyosatlari; **ma’lumot o‘zgartirilmaydi**; ikki marta qo‘llash xavfsiz (sinaldi).
  Funksiyalar 069 dagi jonli ta’riflardan olinib, faqat kerakli joylari o‘zgartirildi (`harness/fix/patch.py`
  har bir almashtirishni aynan 1 marta topilishini tekshiradi).
- Regressiya testlari: `src/lib/__tests__/goldia-acceptance-audit-fixes.test.ts` (9 test),
  `scripts/verify-acceptance-audit-concurrency-local.sh` (F3, haqiqiy PG16 parallel sessiyalar).
- Branch: `ccr-fb8951ce-65agfo` (izolyatsiyalangan). **Merge, deploy yoki production migratsiyasi qilinmadi** —
  alohida release ruxsati kerak.
- F1b (xarajatlar) — hisob siyosati o‘zgarishi: endi `period_accounting_result_585_g` xarajatlardan **keyin**,
  `operational_trading_result_585_g` — xarajatlardan **oldin**. UI formulasi ("Joriy aktiv − Boshlang‘ich −
  Kiritilgan + Yechilgan") va "Rasmiy xarajatlar: −x g" qatori aynan shu ma’noni nazarda tutadi, lekin
  direktor buni tasdiqlashi kerak.

## 10. Sinalmagan narsalar va sabablar

| Narsa | Sabab |
|---|---|
| Production (har qanday yozish, hatto o‘qish) | qoida + kalitlar yo‘q |
| Real Supabase GoTrue/PostgREST | tashqi binar yuklash rad etildi; o‘rniga mos shim. PostgREST’ning nozik farqlari (masalan, overload tanlash, xato kodlari) to‘liq bir xil emas |
| Token muddati tugashi va avtomatik yangilanish | shim bilan aniq natija olinmadi (4-bo‘lim) |
| Telegram orqali login, xodim yaratish API (`auth.admin.createUser`), Google Sheets importi, CBU kursi | tashqi servislar / admin auth API emulyatsiya qilinmadi |
| PWA o‘rnatish, service worker, oflayn rejim, chop etiladigan kvitansiyaning qog‘ozdagi ko‘rinishi | headless brauzerda faqat ekran ko‘rinishi tekshirildi |
| Tarmoq uzilishi aynan commit paytida | har bir RPC bitta tranzaksiya; uzilishda PostgreSQL rollback qiladi — alohida "kill backend" testi qilinmadi, retry/idempotency esa sinaldi |
| Oylik hisobot sana chegaralari | sotuv sanasi har doim `current_date` (orqaga sana yo‘q), shuning uchun turli oylar bo‘yicha real ma’lumot yaratib bo‘lmadi; faqat bugungi davr sinaldi |
| B va C sotuvchilar uchun brauzer sessiyasi | DB/RPC darajasida to‘liq sinaldi, brauzerda faqat A |
| Ko‘p tashkilotli production | production’da nechta tashkilot borligi noma’lum — F9 ta’siri shunga bog‘liq |

## 11. Kompaniya hisobi va fizik oltin mosligi

- **069 holatida: YO‘Q.** Mustaqil rekonsilyatsiya 4 ta buzilishni ko‘rsatdi: fizik balans +1.00 g (oversell),
  CUST-0001 da 3.575 g yo‘qolgan to‘lov, CUST-0006 da 2.0 g yo‘qolgan avans, kompaniya foydasi xarajatlar
  miqdoriga oshirilgan. Dashboard’dagi "BALANS TO‘LIQ MOS" faqat fizik grammlarni tekshiradi — mijoz
  darajasidagi yo‘qotishlarni ko‘rmaydi. Qo‘shimcha: mijozlar sahifasi (`rpc_get_unified_customer_ledger`)
  o‘qish paytida kesh balanslarni qayta yozadi, shuning uchun 069 da bu xatolar kimdir sahifani ochganda
  "o‘z-o‘zidan tuzaladi", ungacha esa dashboard, foyda va keyingi sotuvlar noto‘g‘ri balansdan foydalanadi.
- **070 holatida: HA (sinalgan ssenariylar doirasida).** 45/45 rekonsilyatsiya, ikkala xodim modelida;
  mijozlar sahifasini ochish qiymatlarni o‘zgartirmaydi; direktor va menejer bir xil foydani ko‘radi.

## 12. Yakuniy qaror

**CONTROLLED PILOT GO — shartli:**
1. 070-migratsiya production’ga alohida release ruxsati bilan qo‘llanishi (oldin backup, keyin postflight:
   `scripts/verify-acceptance-audit-concurrency-local.sh` mantiqi + 16 ta regressiya holati).
2. Supabase Auth’da ochiq ro‘yxatdan o‘tish (Enable signups) **o‘chiq** ekanini tasdiqlash (F1 ning
   real xavfi shunga bog‘liq; 070 dan keyin ham himoya qatlami sifatida kerak).
3. Pilot davomida har kuni: dashboard fizik balans + mijozlar sahifasi ochilishidan **oldin** va **keyin**
   foyda raqamini solishtirish (M-13); farq bo‘lsa to‘xtatish.
4. Sotuvchining o‘zi donani qaytarishi va o‘z sotuvini bekor qilishi (M-4) uchun pilotda menejer kunlik
   jismoniy sanoq qilsin.

**REAL GOLD GO berilmaydi:** 069 holatida real mijoz pullari yo‘qolishi mumkin bo‘lgan 4 ta HIGH xato
tasdiqlandi; 070 tuzatishlari faqat izolyatsiyalangan muhitda sinaldi, production’da hali qo‘llanmagan;
token yangilanishi, Telegram login va real PostgREST bilan to‘liq brauzer sinovi bajarilmadi.

**069 holatidagi production uchun: NO-GO (real oltin bilan)** — faqat sintetik/kichik nazoratli pilot.
