# Goldia Sales staging → 074 (073 release candidate + 074 tenant isolation): release tartibi (2026-11-03)

| Loyiha | Ref | Bu ishda |
|---|---|---|
| **Goldia Sales staging** | `vouehtlmsunebracahon` | yagona maqsad |
| Production | `vrozlllcaxinavzxueif` | tegilmaydi (skript ref’ni ko‘rsa, ulanmasdan STOP qiladi) |
| JewelryFlow SaaS demo (`jfs-demo`) | `yvvbdoqncubtwlzskgml` | tegilmaydi (xuddi shunday STOP) |

Bu tayyorgarlik davomida staging’ga hech narsa yozilmagan.

## 1. Staging holati (egasi yuborgan read-only inventarizatsiya)

| Ko‘rsatkich | Staging | Repo 001–062 (lokal PG17) | Repo 001–073 |
|---|---|---|---|
| PostgreSQL | 17.11 | 17.11 | 17.11 |
| Migratsiya tarixi | 60 qator, oxirgisi `…062` | 62 | 73 |
| `public` jadvallar | 61 | 61 | 66 |
| `rpc_*` funksiyalar | **93** | **94** | 99 |
| Tashkilot / xodim / `auth.users` | 60 / 109 / 10 | — | — |
| `jewelry_sales` / `financial_transactions` | 82 / 85 | — | — |
| 069–073 belgilari | yo‘q | — | bor |

Farqlar:
- **Tarix:** staging’da 2 ta versiya yozilmagan.
- **RPC:** staging’da bitta funksiya varianti kam.

Skript shu ikkalasini avval nomma-nom ko‘rsatadi (`parity-062.txt`). Ruxsat beradigan shart — **zanjirdan keyin 073 bilan to‘liq moslik** (7-qadam).
- Yetishmagan obyektni 063–073 qayta yaratsa → davom etadi.
- Yaratmasa → STOP, staging’ga hech narsa yozilmaydi.

## 2. Tanlangan yo‘l — eng qisqa va xavfsiz
063–074 (12 migratsiya) repo’dagi fayllarning o‘zi, **bitta tranzaksiyada**, har biridan keyin o‘sha versiyaning
postflight tekshiruvi. 073 — release candidate (`162a377`) dagi fayl, o‘zgarmagan. 074 — faqat tashkilotlar izolyatsiyasi
(`jewelry_models`, `stage_loss_configs`, ikki model RPC’si); moliyaviy jadval va formulalarga tegmaydi. Biror joyda xato
bo‘lsa yoki 10 s ichida qulf olinmasa, PostgreSQL hammasini qaytaradi va staging 062 da qoladi.
Skript: `scripts/goldia-staging-release.js` (dry run — staging faqat o‘qiladi; `--apply` — hamma gate o‘tgach, project
ref’ni qo‘lda yozganingizdan keyin).

### 074 — `jewelry_models` va `stage_loss_configs` izolyatsiyasi
| | 073 | 074 |
|---|---|---|
| SELECT | hamma tashkilotlar (`using (true)`) | o‘z tashkiloti + `organization_id IS NULL` umumiy eski qatorlar (faqat o‘qish) |
| INSERT/UPDATE/DELETE modellar | rolga qarab, tashkilot sharti yo‘q | o‘z tashkiloti **va** katalog huquqi (admin/director/manager rollari, seller, accountant — avvalgi rollar to‘plami) |
| INSERT/UPDATE/DELETE loss configs | har qanday admin/manager, istalgan tashkilot | o‘z tashkiloti **va** `is_admin_or_manager()` |
| `rpc_create_jewelry_model` (SECURITY DEFINER) | chaqiruvchi tanlagan tashkilot, "birinchi tashkilot" zaxirasi, rol tekshiruvi yo‘q | faqat o‘z tashkiloti, rol tekshiruvi; service_role tashkilotni aniq berishi shart |
| `rpc_update_jewelry_model_photo` (SECURITY DEFINER) | istalgan model ID bo‘yicha | faqat o‘z tashkiloti modeli, rol tekshiruvi |
| Grantlar | anon: hammasi; authenticated: TRUNCATE/MAINTAIN ham | anon: hech narsa; authenticated: faqat SELECT/INSERT/UPDATE/DELETE |
| `organization_id` default | yo‘q | `current_organization_id()` (to‘g‘ridan-to‘g‘ri insert ishlashda davom etadi) |

Fayllar: `supabase/migrations/20260101000074_goldia_tenant_isolation_models_and_loss_configs.sql`,
`supabase/rollback/20260101000074_rollback.sql` (073 holatiga aynan qaytaradi), `supabase/release/074_postflight_readonly.sql` (13 ustun).
Tekshirildi: ikki marta qo‘llash — imzo bir xil (idempotent); rollback — imzo 073 bilan aynan bir xil; qayta qo‘llash — 074.

## 3. Bitta buyruq (Windows PowerShell, repo ildizida, PostgreSQL 17 tools)

```powershell
git fetch origin ccr-fb8951ce-65agfo; git checkout ccr-fb8951ce-65agfo; git pull --ff-only; node scripts/goldia-staging-release.js --apply
```

- **Parol:** staging DB paroli yashirin so‘raladi (`postgres.vouehtlmsunebracahon`); hech qayerga yozilmaydi.
- **Pooler:** staging pooler’i parol yuborilmasdan topiladi. Topilmasa: `--host <Dashboard → Connect → Session pooler host>`.
- **Tasdiq:** hamma natija ekranga chiqadi, so‘ng `Type the staging project ref…` so‘raladi. Faqat `vouehtlmsunebracahon` yozilsa qo‘llanadi; boshqa javob yoki Ctrl+C — hech narsa yozilmaydi.
- **Natija fayli:** `%USERPROFILE%\GoldiaBackups\goldia-staging-<vaqt>\STAGING-074-RESULT.txt`. Unda maxfiy ma’lumot yo‘q.

## 4. PASS / STOP shartlari

Birinchi muvaffaqiyatsiz shartda STOP. 9-qadamgacha staging’ga yozilmaydi.

| # | Qadam | PASS | STOP |
|---|---|---|---|
| 0 | Nishon | user `postgres.vouehtlmsunebracahon` | host/user/`PGHOST`/`PGUSER`/`DATABASE_URL` da production yoki JFS demo ref’i bor; boshqa user |
| 1 | Vositalar | PG17 `psql, pg_dump, pg_dumpall, pg_restore, initdb, pg_ctl`; 063–073 fayllari bor | topilmadi |
| 2 | Ulanish | PostgreSQL **17** | ulanmadi; 17 emas; `pg_dump` serverdan eski |
| 3 | Identifikatsiya | `deployment_environment()` yo‘q (JFS emas), tarixda `062` bor, `>062` yo‘q | JFS belgisi; 062 yo‘q; 063+ allaqachon yozilgan |
| 4 | Backup | `pg_dump -Fc` (public, auth, storage, supabase_migrations) + sxema + rollar, SHA256SUMS, `pg_restore --list` | dump xatosi; backup paytida staging qatorlari o‘zgardi |
| 5 | Restore testi | lokal klasterdagi barcha jadval qator sonlari = staging | farq bor |
| 6 | 062 pariteti | hisobot (`parity-062.txt`) | — (qaror 7-qadamda) |
| 7a | Zanjir lokal nusxada | 12 migratsiya + har birining postflight tekshiruvi bitta tranzaksiyada | biror migratsiya yoki tekshiruv xatosi |
| 7b | Ma’lumot saqlanishi | biznes jadvallari qator soni o‘zgarmagan; har bir tashkilot balansi (mijoz qarzi/avansi, sotuvchi qarzi/zaxirasi, seyf so‘m/USD) bir xil | biror son yoki balans o‘zgardi |
| 7c | 074 pariteti | repo 001–074 dagi har bir funksiya, ustun, policy, trigger, RLS bor | biror obyekt yetishmaydi (funksiya tanasi farqi — REVIEW ro‘yxati) |
| 7d | 073 va 074 postflight | barcha ustunlar `true` | biror ustun `false` |
| 7e | RLS — **har bir login × har bir tashkilot** | `authenticated` (har bir xodim JWT bilan) va `anon`: boshqa tashkilot qatorlarini o‘qish, o‘zgartirish va o‘chirish; sotuvchi boshqa sotuvchi qatorlarini o‘qishi. Zanjir oqishni faqat yopadi | 074 dan keyin **biror** jadvalda tashkilotlararo kirish qolsa |
| 7f | Rollback | 074 rollback → qayta qo‘llash → postflight | xato |
| 8 | Dry run | `DRY RUN PASS` (`--apply` siz shu yerda tugaydi) | — |
| 9 | Qo‘llash | backup’dan beri staging o‘zgarmagan; ref qo‘lda yozildi; bitta tranzaksiya, `lock_timeout 10s` | o‘zgargan; tasdiq mos emas; xato → avtomatik ROLLBACK, staging 062 da |
| 10 | Postflight (staging, read only) | tarix 12/12; 073 + 074 postflight; 074 pariteti; RLS’da kutilmagan oqish yo‘q; biznes qatorlari va tashkilot balanslari o‘zgarmagan | biror shart → STOP + rollback ko‘rsatmasi |

**Muvaffaqiyatli yakun:**
`RESULT: STAGING 062 -> 074 APPLIED, POSTFLIGHT PASS`

**Orqaga qaytarish (faqat 10-qadam STOP bo‘lsa):**
- 074 ni o‘zi: `supabase/rollback/20260101000074_rollback.sql` (ma’lumotni saqlaydi; izolyatsiyani qayta ochadi).
- To‘liq 062 holatiga: shu papkadagi `staging-full.dump` dan tiklash.

## 5a. 074 bilan yakuniy repetitsiya (062 → 074, PG17.11, 60 tashkilot, 200 login)
| Sinov | Natija |
|---|---|
| Dry run / `--apply` + postflight / qayta ishga tushirish | **DRY RUN PASS** / **APPLIED, POSTFLIGHT PASS** / STOP (063+ bor) — `evidence/rehearsal-074-*.txt` |
| Biznes qatorlari / tashkilot balanslari / zavod majburiyati | o‘zgarmadi |
| 074 pariteti | missing 0, tana farqi 0, ortiqcha 0 |
| RLS o‘qish (har bir login × har bir tashkilot + anon) | 062: 11 oqish → **074: PASS (0)**, 9 233 tekshiruv |
| RLS yozish (boshqa tashkilot qatorini UPDATE/DELETE, qaytariladi) | 062: 11 oqish → **074: PASS (0)**, 16 800 tekshiruv |
| Staging postflight RLS | PASS |
| Moliyaviy smoke 24 tashkilot (`evidence/smoke-074-on-062-data.json`) | 073 dagi kabi hammasi o‘tdi |
| `src/lib/__tests__/goldia-074-tenant-isolation.test.ts` (PGlite, haqiqiy `authenticated` roli) | 5/5: SELECT; begona INSERT/UPDATE/DELETE rad; o‘z tashkilotidagi direktor/menejer/sotuvchi huquqlari saqlangan; RPC’lar pin qilingan; grantlar |

## 5. Lokal sinov natijalari (PG17.11, staging shaklidagi baza)

Staging shaklidagi baza:
- repo 001–062 qo‘llangan;
- 60 tashkilot, 202 xodim (200 ta login), 56 sotuv;
- zavod kirimi, konsignatsiya, sotuv, to‘lov, xarid va topshiruv haqiqiy RPC’lar orqali.

Skript `--local-rehearsal` rejimida shu bazani "staging" deb ishlatdi.

| Sinov | Natija |
|---|---|
| Dry run | **DRY RUN PASS** (`evidence/rehearsal-1-dry-run.txt`) |
| `--apply` + postflight | **APPLIED, POSTFLIGHT PASS** (`evidence/rehearsal-2-apply.txt`) |
| Qayta ishga tushirish | STOP: 063+ allaqachon bor (`evidence/rehearsal-3-rerun-after-apply.txt`) |
| Biznes qator sonlari / tashkilot balanslari | o‘zgarmadi |
| Qo‘shilgan qatorlar | tarix +11; `audit_logs` +1 (068 repair yozuvi); `weight_sale_allocations` (yangi jadval) |
| 073 pariteti | missing 0, tana farqi 0, ortiqcha 0 |
| 073 tranzaksiyasiga sun’iy xato | tarix 62 da qoldi, sxema imzosi o‘zgarmadi (atomar) |
| Boshqa sessiya jadvalni qulflagan | 10 s da `lock timeout`, hammasi qaytarildi |
| Staging’da zanjir tiklamaydigan RPC yo‘q bo‘lsa | STOP (7c), staging yozilmagan |
| JFS demo belgisi | STOP (3) |
| Production / JFS ref, boshqa user, lokal bo‘lmagan rehearsal | STOP (0), ulanish ochilmagan |
| Tarixda 2 versiya yozilmagan (staging kabi) | aniqlandi va ko‘rsatildi, sxema to‘liq → PASS |
| 073 dan keyin eski 062 ma’lumotlarida, 24 tashkilot (`evidence/smoke-073-on-062-data.json`) | dona tanlanmagan vazn sotuvi rad etildi 24/24; tanlangan donadan aniq 1.5 g kesildi 24/24; to‘lov (sotuvchining o‘z LOM kursi bilan) 24/24; kassani topshirish 24/24; boshqa tashkilot sotuvchisi rad etildi 24/24; sotuvni bekor qilish 9/9; manfiy dona 0; 073 postflight `t` |

### RLS: 60 tashkilot, 200 login (o‘qish 9 233, yozish 16 800 tekshiruv)

**062 da 11 ta oqish bor edi; 073 zanjiri ulardan 5 tasini yopdi.**

| Oqish | 062 | 073 |
|---|---|---|
| Direktor/menejer boshqa tashkilotlarning **xodimlarini** o‘qiydi va **o‘zgartiradi** (`employees`) | bor | **yopildi** (070 F9) |
| Direktor/menejer boshqa tashkilotlarning `audit_logs` ini o‘qiydi | bor | **yopildi** |
| Sotuvchi boshqa sotuvchining `client_legacy_debts` ini o‘qiydi | bor | **yopildi** (070 F11) |
| `jewelry_models` (shtrix-kod model katalogi): istalgan tashkilot xodimi boshqa tashkilot modelini **o‘qiydi va o‘zgartiradi** | bor | **qoldi** |
| `stage_loss_configs` (ishlab chiqarish): direktor/menejer boshqa tashkilot yozuvlarini **o‘zgartiradi va o‘chiradi** | bor | **qoldi** |

**Yangi oqish ochilmadi.**

Oxirgi ikkitasi 063–073 dan oldin ham bor. Production 072 ham xuddi shu migratsiyalardan qurilgan, demak u yerda ham bor bo‘lishi kerak. Production’da bu tekshirilmagan.

Sabablari:
- `jewelry_models` — `authenticated read … using (true)` va rol bo‘yicha yozish policy’si, tashkilot sharti yo‘q;
- `stage_loss_configs` — `is_admin_or_manager()` bilan `ALL`.

Bu ikkisi **074 da yopildi** (5a-bo‘lim).

Tekshiruv fayllari:
- `supabase/release/staging_rls_isolation_readonly.sql` — read only, staging’da ham ishlaydi;
- `supabase/release/staging_rls_write_isolation_LOCAL_COPY_ONLY.sql` — faqat lokal nusxada, har bir urinish va butun tranzaksiya qaytariladi.

## 6. Frontend: staging’ni `162a377` ga moslashtirish (DB 073 dan keyin)

Hozir staging frontend’i 058–070 oralig‘idagi kod. `/api/version` dagi `da6e930` qo‘lda yozilgan va noto‘g‘ri.

`162a377` dan keyingi commit’larda `src/` o‘zgarmagan: `ccr-fb8951ce-65agfo` HEAD frontend’i = `162a377`.

**Tartib (DB `POSTFLIGHT PASS` dan keyin):**

1. **Env.** Vercel → staging project (`jewelryflow-sales-staging`) → Settings → Environment Variables, **Production va Preview** uchun:
   - `NEXT_PUBLIC_SUPABASE_URL=https://vouehtlmsunebracahon.supabase.co`;
   - staging anon kaliti;
   - `NEXT_PUBLIC_APP_ENV=staging`, `NEXT_PUBLIC_STAGING_MODE=true`;
   - `SUPABASE_SERVICE_ROLE_KEY` — **staging** kaliti (production yoki JFS kaliti emas).
   - `NEXT_PUBLIC_GIT_COMMIT_SHA=da6e930` ni **o‘chiring**: shunda versiya Vercel’ning haqiqiy SHA’sini ko‘rsatadi.
2. **Deploy.** Deployments → Create Deployment → branch `ccr-fb8951ce-65agfo` HEAD (yakuniy release candidate; `src/` 162a377 bilan bir xil — 074 frontend’ni o‘zgartirmaydi) → Production’ga.
   - `NEXT_PUBLIC_*` qiymatlari build paytida kiritiladi. Preview build’ni "Promote" qilsangiz, Preview env ham staging qiymatlarida bo‘lishi shart.
3. **Tekshiruv.** `https://jewelryflow-sales-staging.vercel.app/api/version` → `full_commit=162a377ac18b…`, `supabase_ref=vouehtlmsunebracahon`, `env=staging`. Buni men ham HTTPS orqali faqat o‘qib tasdiqlay olaman.
4. **Oraliq.** DB va frontend deploy oralig‘ida staging’da vazn sotuvi qilmang: eski frontend dona tanlamaydi, 073 uni xavfsiz rad etadi.

## 7. Keyingi maqsad: haqiqiy Supabase Auth bilan to‘liq moliyaviy brauzer audit

Kerak:
- sessiyaning Allowed domains ro‘yxatida `vouehtlmsunebracahon.supabase.co`;
- audit foydalanuvchilarini yaratish/o‘chirish uchun staging service kaliti sessiya muhit sirida (chatda emas).

Audit:
- **Zanjir:** 5 rol, zavod → menejer → sotuvchi → mijoz → to‘lov → topshiruv.
- **Tekshiriladi:** sotuvchining LOM/USD kurslari, nol-reset, Toshkent sana chegarasi, dona tanlash, 60 tashkilot izolyatsiyasi.
- **Talab:** rekonsilyatsiya 0.0000 g.

## Fayllar
- `scripts/goldia-staging-release.js` — release skripti.
- `scripts/lib/goldia-release-checks.js` — versiya postflight tekshiruvlari (production skriptidagi bilan bir xil).
- `supabase/release/staging-073/signature.sql`, `expected-062-signature.txt`, `expected-073-signature.txt` — sxema imzosi (repo’dan PG17 da qurilgan).
- `supabase/release/staging_rls_isolation_readonly.sql`, `staging_rls_write_isolation_LOCAL_COPY_ONLY.sql`.
- `evidence/` — repetitsiya natijalari; `harness/` — lokal PG17 stend (sintetik ma’lumot, parolsiz).
- `01_staging_inventory_readonly.sql` — oldingi read-only inventarizatsiya.
