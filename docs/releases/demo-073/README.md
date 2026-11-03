# Demo `yvvbdoqncubtwlzskgml` → Goldia 073 (xavfsiz yangilash tartibi)

## 1. Topilma: migratsiya versiyalari to‘qnashuvi
| Versiya | Demo (repo’da yo‘q, tashqaridan qo‘llangan) | Production / repo |
|---|---|---|
| 070 | `jewelryflow_organization_profile_and_provisioning` | `goldia_acceptance_audit_fixes` |
| 071 | `jewelryflow_rpc_overloads_and_schema_gaps` | `goldia_seller_company_stock_guard` |
| 072 | `jewelryflow_synthetic_demo_seed` | `goldia_independent_seller_rates` |
| 073 | — | `goldia_release_candidate_stabilization` |

Demo’ning 070–072 fayllari hech bir branch’da yo‘q. Shuning uchun ular faqat demo’ning PostgREST OpenAPI sxemasi bo‘yicha
(READ-ONLY) solishtirildi:
- **Jadvallar:** Goldia 069 jadvallari ustun darajasida bir xil. Demo qo‘shgan: `deployment_settings`, `organization_profiles`,
  `currency_rates` (070 F6 bilan mos ustunlar).
- **RPC:** demo qo‘shgan — `provision_first_director`, `rpc_get/upsert_organization_profile`, `deployment_environment`,
  `demo_seed/reset_synthetic_data`, `_demo_act_as`, `_demo_assert_allowed`.
- **Drift:** `rpc_reverse_financial_transaction` ning 3 argumentli overload’i demo’da ko‘rinmaydi; Goldia 070–073 obyektlari yo‘q
  (070 F1/F8/F11 xatolari demo’da haqiqiy Auth bilan qayta tasdiqlangan).
- Funksiya **tanalari** REST orqali ko‘rinmaydi — demo 071 ularni o‘zgartirgan bo‘lishi mumkin.

Xulosa: 070–073 ni ko‘r-ko‘rona qo‘llash xavfli — versiya yozuvlari to‘qnashadi, o‘zgargan funksiya va overload’lar qolib
ketishi mumkin.

## 2. Tanlangan yo‘l: joyida, bitta atomar "parity bundle"
`01_demo_upgrade_to_073.sql` — bitta tranzaksiya:
1. **Guard:** `deployment_environment()` = `demo` va `deployment_settings.environment = 'demo'` bo‘lmasa, to‘xtaydi.
   Production’da bu obyektlar yo‘q.
2. Goldia 070, 071, 072, 073 — repo’dagi aynan matn (commit `162a377`).
3. **Parity:**
   - 155 ta Goldia funksiyasi 073 ta’rifi va grantlari bilan qayta yaratiladi;
   - 073 da yo‘q Goldia nomli overload va policy’lar o‘chiriladi;
   - 118 policy aynan 073 dagidek bo‘ladi, 66 jadvalda RLS yoqiladi.
4. **Tranzaksiya ichidagi tekshiruv:** funksiya fingerprint’i (manba + argumentlar + atributlar), grantlar, policy’lar, jadval
   ustunlari va RLS — farq bo‘lsa hammasi ROLLBACK.

Bundle o‘zgartirmaydigan narsalar: biznes qatorlari, `auth.users`, demo’ga xos obyektlar va `supabase_migrations`
(to‘qnashuvni oldini olish uchun). Production migratsiya tarixiga tegilmaydi.

**Nega yangi loyiha emas:** demo bir martalik, lekin bu sessiyaning kalitlari va tarmoq ruxsati aynan shu loyihaga sozlangan.
Yangi loyihada 001–073 baribir SQL orqali qo‘llanadi (sessiya raw-TCP Postgres’ga ulana olmaydi), ustiga kalitlar va ruxsatni
qayta sozlash kerak bo‘ladi. Parity bundle shu demo’da aynan 073 sxemasini isbotlaydi.

## 3. Lokal sinov (PG16; 069 + demo simulyatsiyasi: qo‘shimcha jadval/RPC, o‘chirilgan overload, ortiqcha overload, o‘zgargan tana, ochiq policy)
| Holat | Natija |
|---|---|
| Bundle’dan oldin parity postflight | FAIL — 54 farq |
| Bundle | PASS: guard o‘tdi, ortiqcha overload va policy o‘chirildi, "PARITY OK" |
| Bundle’dan keyin parity postflight | **PASS, 0 farq** |
| Qayta ishga tushirish | PASS (idempotent) |
| Biznes qatorlari, auth, demo obyektlari | o‘zgarmadi |
| 073 bazada funksional ssenariy / rekonsilyatsiya | 27/27, 25/25 |
| Production’ga o‘xshash baza (demo belgisi yo‘q) | REFUSED, sxema imzosi o‘zgarmadi |
| `deployment_environment() = 'production'` | REFUSED |
| Mos kelmaydigan drift (qaytarish turi boshqa) | xato → ROLLBACK, sxema imzosi aynan o‘zgarmadi |

## 4. Bajarish tartibi (egasi)
1. **Backup:** Dashboard → Database → Backups (yoki `pg_dump`).
2. Bundle’ni ishga tushirish (psql tavsiya etiladi, fayl 1.1 MB):
   ```
   psql "<demo DATABASE_URL>" -v ON_ERROR_STOP=1 -f docs/releases/demo-073/01_demo_upgrade_to_073.sql
   ```
   Yoki: Dashboard → SQL Editor → faylni to‘liq joylab, bir marta **Run**. Natijada `PARITY OK` NOTICE chiqadi;
   har qanday ERROR — hech narsa o‘zgarmagan.
3. **Postflight:** `02_demo_parity_postflight_readonly.sql` → `PASS | 0`.

## 5. Synthetic seed va Auth
- Mavjud demo foydalanuvchilari va ma’lumotlari o‘zgarmaydi.
- Test uchun alohida sintetik audit foydalanuvchilari (direktor, menejer, sotuvchi A, B, C) service-role admin API orqali
  yaratiladi (`docs/audits/goldia-authenticated-final/harness/create-users.js`). Parollar chiqarilmaydi, test tugagach
  o‘chiriladi.
- Tranzaksion ma’lumotlar (kirim, konsignatsiya, sotuv, to‘lov) brauzer testi orqali yangidan yaratiladi.
- Demo’ning `demo_seed_synthetic_data` funksiyasi ishlatilmaydi: u 073 dan oldingi imzolarga tayangan bo‘lishi mumkin.

## 6. Qayta generatsiya
`tooling/gen-bundle.py` 001–073 dan qurilgan bazadagi kutilgan holatdan (`tooling/expected.sql`) bundle va postflight yasaydi.
Sinov uchun demo simulyatsiyasi: `tooling/sim-demo-extras.sql`.
