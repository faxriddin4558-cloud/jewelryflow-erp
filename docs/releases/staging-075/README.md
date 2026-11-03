# Goldia Sales 075 — mijoz kodlari tashkilot bo‘yicha (F-STG-1) va factory settings izolyatsiyasi (F-STG-2)

**Holat:** release candidate. Staging’ga **qo‘llanmagan** (egasining ruxsati kutilmoqda). Production / JFS Demo / manufacturing ERP — tegilmagan.

## 1. Nima o‘zgardi (bitta migratsiya)

`supabase/migrations/20260101000075_goldia_customer_codes_per_org_and_factory_settings_isolation.sql`

| Muammo | Tuzatish |
|---|---|
| Kod butun jadvaldagi **barcha** kodlar raqamidan `::integer` bilan olinardi → boshqa tashkilotdagi bitta uzun kod hamma uchun overflow | Raqam faqat **o‘z tashkilotining** `^CUST-\d{1,9}$` kodlaridan, `bigint` bilan; boshqa/g‘alati kodlar e’tiborsiz |
| `customer_code` global unique | `UNIQUE NULLS NOT DISTINCT (organization_id, customer_code)` — har tashkilot mustaqil; mavjud kodlar o‘zgarmaydi |
| Parallel yaratishda kolliziya (074 da 60 parallel → 39 ta `duplicate key`) | Tashkilot bo‘yicha `pg_advisory_xact_lock`; bir xil nomni parallel yaratish ham bitta mijoz beradi |
| `lpad(...,4)` 10000 ni `CUST-1000` ga kesardi (test topdi, 038 dan beri) | `lpad(n, greatest(4, length(n)))` |
| Har qanday sotuvchi PostgREST orqali ixtiyoriy kodli mijozni to‘g‘ridan-to‘g‘ri INSERT qila olardi | `anon`: customers’ga hech qanday huquq yo‘q; `authenticated`: INSERT/TRUNCATE/MAINTAIN olib tashlandi (SELECT/UPDATE/DELETE RLS bilan qoladi); `customer_code`/`organization_id` ni to‘g‘ridan-to‘g‘ri UPDATE — trigger rad etadi |
| `p_seller_id` tekshirilmasdi | Sotuvchi o‘sha tashkilotdan bo‘lishi shart; sotuvchi faqat o‘zi uchun; rol `customers_tenant_manage` bilan bir xil to‘plam |
| `rpc_get_factory_settings(p_organization_id)` begona tashkilot nomi/kodi/sozlamalarini qaytarardi, `goldia` fallback | Faqat chaqiruvchining tashkiloti; boshqa id → 42501; tashkilotsiz → 42501; lazy insert `on conflict do nothing` (074 da parallel birinchi o‘qish `duplicate key` berardi) |

Moliyaviy jadval, formula, balans yoki mavjud qator o‘zgarmaydi. Frontend kodi o‘zgarmagan. Seed/test fayllaridagi
`ON CONFLICT (customer_code)` → `ON CONFLICT (organization_id, customer_code)` (4 joy).

Rollback: `supabase/rollback/20260101000075_rollback.sql` — 074 holatini aynan tiklaydi (imzo bir xil; customers ACL bir xil).
Agar 075 dan keyin ikki tashkilotda bir xil kod paydo bo‘lgan bo‘lsa, rollback **hech narsani o‘zgartirmay** rad etadi (mijozlarni qayta nomlamaydi).
Postflight: `supabase/release/075_postflight_readonly.sql` (16 ustun).

## 2. Tekshiruvlar (hammasi lokal, haqiqiy PostgreSQL 17)

| Tekshiruv | Natija |
|---|---|
| `src/lib/__tests__/goldia-075-…test.ts` (PGlite = PG17, rol `authenticated`): 074 xatosini qayta tiklaydi, keyin 075 | 10/10 |
| Butun vitest to‘plami | 346/346 (`evidence/vitest-full.txt`) |
| PG17 server, ko‘p ulanish (`harness/pg17-concurrency.js`) — 074: | ekilgan kod bilan 1/6, kodsiz 2/6 (60 paralleldan 39 `duplicate key`; factory settings race) |
| … 075: | 6/6 ikkala holatda (60 parallel → 60 ketma-ket kod; 12× bir nom → 1 mijoz; 2 tashkilot parallel; direct INSERT rad; 10× settings → 1 qator) |
| Idempotentlik (ikki marta qo‘llash) | imzo bir xil |
| Rollback → imzo = `expected-074`; qayta qo‘llash → imzo = `expected-075` | ok |
| Release skripti rehearsal (staging shaklidagi stand-in: 60 tashkilot, 200 login, 074, ekilgan uzun kod) | DRY RUN PASS → APPLIED, POSTFLIGHT PASS → qayta ishga tushirish STOP (`evidence/rehearsal-*.txt`) |
| RLS o‘qish / yozish (har login × har tashkilot), 074 → 075 | 9 226 / 16 800 tekshiruv, 0 oqish; balanslar va biznes qatorlari o‘zgarmagan |

## 3. Staging’ga qo‘llash (FAQAT egasining ruxsati bilan)

```powershell
git fetch origin claude/goldia-sales-staging-audit-qtrq1d
git checkout --detach <RC_SHA>
node scripts/goldia-staging-release.js            # dry run: backup + restore test + lokal nusxada 075 + RLS; staging faqat o'qiladi
node scripts/goldia-staging-release.js --apply    # ref'ni yozib tasdiqlaysiz; 075 bitta tranzaksiyada; postflight
```
Kutilgan: `RESULT: STAGING 074 -> 075 APPLIED, POSTFLIGHT PASS`. Skript 074 yozilmagan yoki 075 allaqachon bo‘lsa to‘xtaydi; production va JFS ref’larini rad etadi.

## 4. Staging frontend deploy (075 qo‘llangandan keyin)

```powershell
git checkout --detach <RC_SHA>
powershell -ExecutionPolicy Bypass -File docs/releases/staging-075/deploy-staging-frontend.ps1 -ReleaseCandidate <RC_SHA>
```
Skript: faqat `jewelryflow-sales-staging`; env (staging URL, `NEXT_PUBLIC_APP_ENV=staging`, `NEXT_PUBLIC_STAGING_MODE=true`) Production va Preview uchun;
anon va service kalitlarini Vercel CLI interaktiv so‘raydi; eski `NEXT_PUBLIC_GIT_COMMIT_SHA=da6e930` o‘chiriladi; JWT `ref` staging ekanini tekshiradi;
`vercel deploy --prod --build-env NEXT_PUBLIC_GIT_COMMIT_SHA=<RC>`; `/api/version` → `full_commit=<RC>`, `supabase_ref=vouehtlmsunebracahon`, `env=staging`.
Skript bu sessiyada ishga tushirilmagan (Vercel tokeni va tarmoq ruxsati yo‘q).

## 5. Lokal stend (takrorlash uchun)

`harness/stack-db.sh` (PG17 + haqiqiy GoTrue, Docker), `harness/gateway.js` (Kong o‘rnida, 127.0.0.1:54321), PostgREST 12.2.3,
`harness/standin-seed.js` (staging shakli), `harness/pg17-concurrency.js`. Hamma sirlar — faqat lokal, sintetik.
