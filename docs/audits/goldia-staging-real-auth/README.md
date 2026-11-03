# Goldia Sales — staging’da haqiqiy Supabase Auth bilan moliyaviy audit (074)

> **Yangilanish:** F-STG-1 va F-STG-2 migratsiya 075 da tuzatildi (staging’ga hali qo‘llanmagan) — `docs/releases/staging-075/README.md`, audit: `docs/audits/goldia-075-real-auth/README.md`.

**Sana:** 2026-11-03 · **Staging:** `vouehtlmsunebracahon` (sxema 063–074, POSTFLIGHT PASS) · **Release candidate:** `90b8191` (PR #13)
**Production va JFS Demo:** tegilmadi (hatto o‘qilmadi). Yangi migratsiya yo‘q, production deploy yo‘q.

## 0. Natija qisqacha

| Bo‘lim | Natija |
|---|---|
| Staging kaliti va ulanish (qiymatlar ko‘rsatilmadi) | **PASS** — JWT `ref=vouehtlmsunebracahon`, `role=service_role`; REST 200, Auth health 200, Auth admin 200 |
| Staging frontend deploy | **BLOKLANGAN** — 5-bo‘lim |
| Haqiqiy GoTrue login’lari (5 rol + xodimsiz) | **PASS** — noto‘g‘ri parol 400 |
| To‘liq moliyaviy zanjir (haqiqiy JWT, haqiqiy PostgREST/RLS) | **30/30 PASS** |
| Mustaqil rekonsilyatsiya | **14/14 PASS, maksimal farq 0.0000 g** |
| Nol-reset (rol cheklovi, faqat o‘z tashkiloti, 072 kassa puli) | **PASS** ×3; qolgan 60 tashkilot o‘zgarmagan |
| F-073 regressiyasi (reset’dan keyin topshiruv aynan 2.0 g) | **PASS** |
| Toshkent sana chegarasi (deploy qilingan `_goldia_business_date`) | **PASS** — kun/oy/yil chegaralari |
| Tashkilotlararo izolyatsiya | 43 jadval × 4 login: **0 oqish**; begona tashkilotga INSERT rad (customers, jewelry_models) |
| **Yangi topilmalar** | **F-STG-1 (HIGH)**, **F-STG-2 (MEDIUM)** — 3-bo‘lim |

## 1. Izolyatsiya va xavfsizlik choralari

- Har bir skript `harness/lib.js` dagi guard orqali kalitning JWT payload’ini tekshiradi: `ref` staging bo‘lmasa yoki rol
  `service_role` bo‘lmasa — to‘xtaydi. Production/JFS URL’lari skriptlarda umuman yo‘q.
- Barcha yozuvlar **bitta alohida sintetik tashkilotda**: `GOLDIA-AUDIT-20261103`
  (`a5d17000-0000-4000-8000-202611030001`). Staging’dagi 60 ta mavjud tashkilotning ma’lumotlariga yozilmadi.
  Har bir reset oldidan va keyin qolgan tashkilotlarning `manager_vault_account` qatorlari solishtirildi — bir xil.
- Audit foydalanuvchilari: `audit.stg.{director,manager,sellera,sellerb,sellerc,noemp}@goldia-audit.test` — service-role admin API
  orqali yaratildi. Parollar tasodifiy, faqat konteynerdagi `0600` faylda; chatga, loglarga, GitHub’ga yozilmadi.
- Foydalanuvchi so‘rovlarida `Authorization` — foydalanuvchining **haqiqiy GoTrue JWT**’i (PostgREST roli `authenticated`, RLS ishlaydi).
  Tekshirildi: direktor/menejer 1 tashkilot va 5 xodimni, sotuvchi faqat o‘zini, xodimsiz login hech narsani ko‘rmaydi.
- Audit oxirida tashkilot nol-reset qilindi (barcha balanslar 0), 6 foydalanuvchi **bloklandi** (`ban_duration`), o‘chirilmadi —
  audit qatorlari referensial butun qoladi. Bloklangandan keyin login → 400 (tekshirildi).

> Staging’da anon kaliti sessiya muhitida yo‘q, shuning uchun `apikey` sarlavhasida service kaliti, `Authorization`’da esa
> foydalanuvchi JWT’i yuborildi. PostgREST rolni `Authorization` dagi JWT bo‘yicha belgilaydi — RLS natijalari buni tasdiqlaydi.
> Anonim (`anon`) ssenariylari shu sababli bu safar **tekshirilmadi**.

## 2. Moliyaviy zanjir (`harness/finance.js`, `evidence/finance.json`) — 30/30

Kutilgan qiymatlar skriptning o‘zida mustaqil hisoblanadi.

| # | Operatsiya | Kutilgan | Haqiqiy |
|---|---|---|---|
| P1 | Zavod kirimi 500 g @8% + bir xil kalit bilan retry | majburiyat 540, ombor 500, bitta kirim | ✅ |
| P2/P3 | Menejer → A 200 g @15%, → B 100 g @12% | 230 / 112; menejerda 200 g | ✅ |
| P4c/d | Dona tanlanmagan vazn sotuvi; B donasini A kesishi | `ERR_PIECE_REQUIRED` / `ERR_PIECE_NOT_AVAILABLE` | ✅ |
| P4a/b | Barcode 12.5 g @12%; vazn sotuvi 40 g @15% (30 g butun + 50 g donadan 10 g) | 14.0 / 46.0; 50 g donada 40 g qoladi | ✅ |
| P5 | B: 25 g @20% | 30.0 | ✅ |
| D1 | Sotuv sanasi | Toshkent sanasi `2026-11-03` | ✅ |
| P7/P7b | A 890 000 / 12 500; B 900 000 / 12 700; diapazondan tashqari kurs; menejer sotuvchi RPC’si | saqlanadi / rad / rad | ✅ |
| P9a | Brauzer yuborgan boshqa kurs | `ERR_RATE_MISMATCH` | ✅ |
| P9b | A: 4 450 000 so‘m + 200 USD + 3.0 g @750 (+retry) | 5 + 2.8090 + 3.8462 = 11.6552, bitta to‘lov | ✅ |
| P6 | Eski qarz 3 g + sotuv 14 g − to‘lov | 5.3448 | ✅ |
| P8 | B: 9 000 000 so‘m + 100 USD | 11.4111 | ✅ |
| P10 | A kursini 920 000 ga o‘zgartirib topshiradi | 21.6552 g, gramm yaratilmaydi/yo‘qolmaydi | ✅ |
| P10b/c | B topshiruvi; A B kassasini topshirishi | 11.4111 / rad | ✅ |
| P11 | 2 000 000 so‘mga 2.5 g xarid, pul o‘rtacha kursi 894 000 | kurs farqi +0.262864 g | ✅ |
| P13a–c | Ishorali ustama farqi; A B hisobotini o‘qishi; B sotuvi bekor qilingach | +1.625 / rad / −0.375 | ✅ |
| P15a | To‘langan B sotuvini bekor qilish, ikkinchi marta bekor qilish | qarz 0, avans 11.4111 / rad | ✅ |
| P15b | 100 g donani qaytarish | majburiyat −115 | ✅ |
| P14a/b | Afinaj 3.0 g @750 → 2.24 g @999; zavodga topshirish | chiqish 3.8252, yo‘qotish 0.0210; majburiyat 533.6748 | ✅ |
| S1–S3 | A: B kurslari/tarixi/limitlari/kompaniya zaxirasi; menejer barcha kurslarni ko‘radi; xodimsiz login | rad / 3 sotuvchi / rad | ✅ |

## 2a. Mustaqil rekonsilyatsiya (`harness/recon.js`, `evidence/reconciliation.json`) — 0.0000 g

| Ko‘rsatkich | Kutilgan (faqat ssenariy kiritmalaridan) | Haqiqiy |
|---|---|---|
| Mijozlar qarzi | (17 − 11.6552) + (46 − 10) = 41.3448 | 41.3448 |
| Mijozlar avansi | 11.4111 | 11.4111 |
| A majburiyati / qarzi | 230 + 3 (eski qarz) − 115 = 118 / 96.3448 | 118 / 96.3448 |
| B majburiyati / qarzi | 112 / 100.5889 | 112 / 100.5889 |
| A donalari: qo‘lda + sotilgan + qaytarilgan | 47.5 + 52.5 + 100 = 200 | 200 |
| Menejer ombori / so‘m / USD | 300 g / 20 350 000 / 300 | 300 / 20 350 000 / 300 |
| Zavod majburiyati | 533.6748 | 533.6748 |
| Ilovaning `rpc_get_financial_reconciliation_summary` | yuqoridagilar bilan bir xil | bir xil |

## 2b. Reset, F-073, sana, izolyatsiya

- **Reset** (`harness/reset.js`, `evidence/reset-*.json`): menejer, sotuvchi va noto‘g‘ri kod — rad; direktor — audit tashkilotining
  barcha balanslari 0, shu jumladan 072 dagi `till_valued_*`. Qolgan 60 tashkilot — o‘zgarmagan (3 marta).
  (Birinchi urinishda `R2` FAIL harness xatosi edi: reset kirimlarni `reversed` qiladi, skript `cancelled` ni sanagan; tuzatildi.)
- **F-073** (`harness/post-reset.js`): reset’dan keyin 1 840 000 so‘m / 920 000 = 2.0 g to‘lov; kassa 2.0 g; topshiruv **aynan 2.0 g**.
- **Sana** (`harness/iso.js` D2): `_goldia_business_date(p_at)` staging’da — 23:59/00:00/04:59 TKT, oy oxiri, yangi yil — hammasi Toshkent sanasi.
- **Izolyatsiya** (I1–I3): `organization_id` ustunli 43 jadval/view × 4 login = 172 o‘qish — 0 begona qator.
  Begona tashkilotga `customers` (sotuvchi) va `jewelry_models` (menejer, 074) INSERT — RLS rad etdi.
  Jonli staging’da boshqa tashkilot qatorlarini UPDATE/DELETE qiluvchi probalar ataylab ishlatilmadi (lokal nusxada 16 800 tekshiruv — staging-073 README 5a).

## 3. Yangi topilmalar

### F-STG-1 — bitta mijoz kodi barcha tashkilotlarda mijoz yaratishni to‘xtatadi (HIGH)

- **Hozir staging’da:** `rpc_create_customer_with_code` **har bir tashkilot uchun** xato beradi:
  `value "0561793002353699" is out of range for type integer`. UI (`CustomerLedgerAndSheetsSection.tsx`) aynan shu RPC’dan foydalanadi —
  staging’da hech kim yangi mijoz qo‘sha olmaydi.
- **Ildiz sababi** (`supabase/migrations/20260101000038_final_sales_mega_fix.sql`): keyingi raqam **butun `customers` jadvali** bo‘yicha
  `max(regexp_replace(customer_code, '\D', '', 'g')::integer)` bilan olinadi. Boshqa tashkilotdagi bitta
  `CUST-T999_9999999999999` ko‘rinishidagi kod (2026-10-26 da yaratilgan, 16 raqam) `integer` chegarasidan oshadi.
  Kodlardagi barcha raqamlar birlashtiriladi (`CUST-NCDN` kabi kodlar ham noto‘g‘ri raqam beradi).
- **Kim buza oladi:** har qanday tashkilotning oddiy sotuvchisi — `customers_tenant_manage` policy’si `customer_code` ni tekshirmaydi,
  PostgREST orqali to‘g‘ridan-to‘g‘ri INSERT ishlaydi (`harness/custprobe.js`, `evidence/customer-code-probe.json`: haqiqiy sotuvchi JWT bilan
  ixtiyoriy kodli mijoz yaratildi; zararsiz kodlar ishlatildi). Ya’ni bitta tenant **barcha tenantlar** uchun mijoz yaratishni o‘chira oladi.
- **Production ta’siri:** tekshirilmadi (production’ga tegilmadi). Kod production’da ham bir xil, shuning uchun xavf bir xil.
- **Tavsiya (keyingi migratsiya, bu safar qilinmadi):** raqamni faqat `^CUST-\d{1,9}$` kodlardan va `bigint`/sequence orqali olish
  (yoki alohida `customer_code_seq`); `customer_code` uchun CHECK/trigger; mijozni faqat RPC orqali yaratish (to‘g‘ridan-to‘g‘ri INSERT’ni yopish).
- **Staging’ni darhol tiklash:** o‘sha bitta mijoz kodini (`CUST-T…`) normal `CUST-NNNN` ga o‘zgartirish. Bu boshqa tashkilot ma’lumoti —
  egasining ruxsatisiz o‘zgartirilmadi.
- Audit uchun mijozlar sotuvchi JWT’i bilan to‘g‘ridan-to‘g‘ri INSERT orqali (o‘z tashkilotida) yaratildi; qolgan zanjirga ta’sir qilmaydi.

### F-STG-2 — `rpc_get_factory_settings(p_organization_id)` boshqa tashkilot sozlamalarini qaytaradi (MEDIUM)

- `security definer`, `p_organization_id` chaqiruvchining tashkilotiga solishtirilmaydi (`20260101000023_…sql`). Har qanday login
  (sotuvchi ham) boshqa tashkilotning **nomi, kodi** va zavod sozlamalarini oladi; sozlama qatori bo‘lmasa, **begona tashkilot uchun qator yaratadi**.
- Staging’da tashkilot ID’lari ketma-ket (`00000000-…-000000000001`, …) — taxmin qilish oson.
- Probada begona tashkilotga yangi qator yozilmadi (mavjud qator 2026-10-22 dan).
- **Tavsiya:** `p_organization_id` ni e’tiborsiz qoldirish yoki `= current_organization_id()` bo‘lmasa rad etish; “goldia” fallback’ini olib tashlash.

### Qayta tasdiqlangan, ochiq: M-7 (vazn sotuvida dona tanlash) 073 da yopilgan — staging’da `ERR_PIECE_REQUIRED` ishlaydi. M-14 (sana) — yopilgan (D1, D2).

## 4. Qaror

DB qatlami (074) haqiqiy Auth bilan moliyaviy jihatdan **to‘g‘ri**: 30/30, rekonsilyatsiya 0.0000 g, reset va izolyatsiya PASS.
**Staging GO emas**: F-STG-1 staging’da mijoz yaratishni to‘liq to‘xtatgan va har qanday tenant uni qayta keltirib chiqarishi mumkin.
Production’ga 073/074 chiqarishdan oldin F-STG-1 (va F-STG-2) uchun alohida migratsiya kerak — egasi qarori bilan.

## 5. Bloklangan qismlar

1. **Staging frontend deploy.** Sessiyada Vercel tokeni yo‘q, `jewelryflow-sales-staging.vercel.app` esa sessiya tarmoq siyosatida rad etilgan
   (proxy 403). Deploy egasi tomonidan staging-073 README 6-bo‘limidagi tartibda bajarilishi kerak
   (env: staging URL + **staging anon kaliti**, `NEXT_PUBLIC_GIT_COMMIT_SHA` ni o‘chirish; branch `ccr-fb8951ce-65agfo` / `90b8191`).
2. **Brauzer auditi haqiqiy Auth bilan.** Kerak: (a) staging **anon kaliti** sessiya siri sifatida (`GOLDIA_STAGING_ANON_KEY`) — shunda frontend’ni
   konteynerda staging’ga ulab, Playwright bilan tekshirish mumkin; yoki (b) Allowed domains’ga `jewelryflow-sales-staging.vercel.app`
   qo‘shilib, deploy qilingan frontend. Foydalanuvchilarni qayta yoqish: `node harness/ban-users.js none` + yangi parollar (`setup.js` mantiqi).
3. **Anonim (`anon`) ssenariylari** — anon kaliti bo‘lmagani uchun.

## Fayllar

- `harness/lib.js` — guard, haqiqiy login, RPC/REST yordamchilari · `setup.js` — audit tashkiloti va foydalanuvchilar
- `finance.js`, `recon.js`, `reset.js`, `post-reset.js`, `iso.js`, `custprobe.js`, `probe.js`, `ban-users.js`
- `evidence/*.json` — natijalar (maxfiy ma’lumotsiz)
