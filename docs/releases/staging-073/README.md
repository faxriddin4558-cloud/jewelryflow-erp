# Goldia Sales staging — 073 tayyorgarligi (2026-11-03)

`jfs-demo` (`yvvbdoqncubtwlzskgml`) JewelryFlow SaaS loyihasi. Goldia testlari uchun ishlatilmaydi.
Hech qaysi bazaga yozilmagan.

## Dalillar (ochiq HTTPS orqali, faqat o‘qish)

| | Staging `jewelryflow-sales-staging.vercel.app` | Production `goldia-sales-production.vercel.app` |
|---|---|---|
| `/api/version` → `supabase_ref` | `vouehtlmsunebracahon` | `vrozlllcaxinavzxueif` |
| Brauzer bundle’idagi `NEXT_PUBLIC_SUPABASE_URL` | `https://vouehtlmsunebracahon.supabase.co` | `https://vrozlllcaxinavzxueif.supabase.co` |
| Anon kalit JWT `ref` / `role` | `vouehtlmsunebracahon` / `anon` | — |
| `env` / `staging_mode` | `staging` / `true` | `production` / `false` |
| `/api/version` → `commit` | `da6e930` (7 belgi) | `2a70155…` (to‘liq SHA) |

**Mustaqillik.** Ikki sayt ikki xil Supabase project’iga ulangan.
- Kodda faqat bitta Supabase URL bor (`NEXT_PUBLIC_SUPABASE_URL`). Server tomonidagi `SUPABASE_SERVICE_ROLE_KEY` ham shu URL bilan ishlatiladi.
- `DATABASE_URL` yoki ikkinchi Supabase manzili kodda yo‘q.
- Shu sabab staging’dagi yozuvlar production bazasiga tusha olmaydi. Production kaliti staging project’ida qabul qilinmaydi (JWT boshqa project siri bilan imzolangan).

**Staging kodi.**
- `commit=da6e930` ishonchli emas. `da6e930` — migratsiya 045 davri. Unda `/api/version` route’i umuman yo‘q (route 058 da qo‘shilgan).
- Qiymat 7 belgili, demak u Vercel’ning git SHA’si emas, qo‘lda berilgan `NEXT_PUBLIC_GIT_COMMIT_SHA`.
- Bundle taqqoslovi: 12 ta JS chunk’dan 9 tasi production bilan aynan bir xil. Farq qilgan 3 tasida `sales` roli `Accountant` deb belgilangan. Bu 071 (`49ba461`) dan oldingi kod.
- Xulosa: staging frontend’i 058–070 oralig‘idagi commit, 071/072/073 frontend’i emas.

**Server env.** Vercel API va dashboard bu sessiyadan ko‘rinmaydi. Shuning uchun server env qiymatlari (`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`) tekshirilmagan. Kod ishlatadigan nomlar:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
- `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_STAGING_MODE`, `NEXT_PUBLIC_GIT_COMMIT_SHA`;
- `NEXT_PUBLIC_DEMO_PASSWORD`;
- `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`.

## Bloklangan qism

Staging bazasining migratsiya tarixi va ma’lumotlari tekshirilmagan (**NOT VERIFIED**). Sababi:
- sessiya tarmog‘i `vouehtlmsunebracahon.supabase.co:443` ga ulanishni rad etadi (proxy CONNECT 403);
- `supabase_migrations` jadvali PostgREST orqali umuman ko‘rinmaydi.

## Faqat o‘qiydigan inventarizatsiya

`01_staging_inventory_readonly.sql` faylini staging SQL Editor’ida ishga tushiring.
- `begin transaction read only … rollback` ichida ishlaydi.
- Natija bitta `check | value` jadvali. Ism, telefon, summa va e-mail chiqmaydi, faqat sonlar va obyekt mavjudligi.
- Ko‘rsatadi:
  - migratsiya tarixi (≥060, nomlari bilan);
  - 069–073 belgilari;
  - JFS qo‘shimcha jadvallari bormi;
  - `auth.users` va xodimlar soni (rollar bo‘yicha);
  - asosiy jadvallardagi qatorlar soni.
- Lokal PG16’da sinovdan o‘tgan: migratsiya jadvali bor va yo‘q holatlar, 069 bazasi.

## Natijaga qarab keyingi yo‘l

- **Tarix Goldia 001–072 bo‘lsa.** Production bilan bir xil yo‘l: `node scripts/goldia-prod-release.js --migration 073` staging’ga.
  - backup → compat → damage scan → 073 → `073_postflight_readonly.sql` 12/12;
  - so‘ng PR #13 frontend’ini staging’ga deploy qilish.
  - Bu ham production release’ining repetitsiyasi bo‘ladi.
- **Tarixda boshqa 070–072 bo‘lsa** (JFS kabi). Staging uchun `docs/releases/demo-073` dagi himoyali bundle moslashtiriladi.
- **Haqiqiy Auth testi uchun** sessiya Allowed domains ro‘yxatiga `vouehtlmsunebracahon.supabase.co` qo‘shilishi kerak. Audit foydalanuvchilarini yaratish/o‘chirish uchun staging service kaliti muhit sirlariga qo‘yilishi kerak (chatga emas).
