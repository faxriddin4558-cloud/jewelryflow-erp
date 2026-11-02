# 070 — production release (Goldia Sales)

**Holat:** tayyor, production’ga qo‘llanmagan. Release faqat egasi tomonidan, quyidagi buyruq bilan.

## Bitta buyruq (Windows PowerShell, repo ildizida, PostgreSQL 17 tools o‘rnatilgan)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\release-070.ps1
```

Ketma-ketlik (birinchi xato — to‘xtash, production o‘zgarmaydi):
1. Branch `ccr-fb8951ce-65agfo`, `npm ci`, typecheck, 070 regressiya testlari.
2. Yangi `pg_dump` backup → lokal PostgreSQL’ga restore → qator sonlari productionga teng (restore-test).
3. Tiklangan nusxada: 070 qo‘llash → postflight → rollback → qayta qo‘llash (compat).
4. READ-ONLY: 069 bor, 070 yo‘q, buxgalteriya tekshiruvi, **zarar skaneri** (`supabase/release/070_damage_scan_readonly.sql`,
   faqat son/gramm, ism-telefon yo‘q). `REVIEW` qatori bo‘lsa — **to‘xtaydi**, hech narsa tuzatilmaydi.
5. 070 + `schema_migrations` qatori bitta tranzaksiyada (`lock_timeout 10s`).
6. Postflight: 17 tekshiruv (`supabase/release/070_postflight_readonly.sql`), qator sonlari va balanslar o‘zgarmagan.

Natija: `%USERPROFILE%\GoldiaBackups\goldia-prod-<vaqt>\RELEASE-070-RESULT.txt`, `damage-scan-070.txt`, `SUMMARY.txt`.

## Zarar skaneri REVIEW bersa
- `D1` (mijoz keshi ≠ hujjatlar): Mijozlar va Nasiya sahifasini ochish keshni hujjatlardan qayta hisoblaydi; keyin skanerni qayta
  ishga tushiring. Hujjatlar (sotuv, to‘lov, eski qarz) to‘g‘ri bo‘lgani uchun yo‘qotish faqat keshda.
- `D3` (dublikat zavod kirimi): menejer qog‘oz hujjat bilan solishtiradi; ortiqchasini UI’dagi "kirimni bekor qilish" bilan
  qaytaradi (yozuv o‘chirilmaydi, reversal yoziladi).
- `D4/D5/D6` (oversell, fizik farq): sotuvchidan jismoniy sanoq; noto‘g‘ri butun-partiya sotuvini UI orqali bekor qilish
  (070 bilan bekor qilish mijoz to‘lovini avansga o‘tkazadi).
- `D7` (zavod majburiyati): 068 repair loglari bilan solishtirish.
- `D11` >1 tashkilot yoki `D12` tashkilotsiz faol xodim: F9 ta’siri — egasi tekshiradi.
Egasi ko‘rib chiqqandan keyin: `node scripts/goldia-prod-release.js --migration 070 --acknowledge-findings`.
070 eski yozuvlarni **o‘zgartirmaydi** — faqat yangi zararni oldini oladi.

## Rollback
`psql "<same connection>" -v ON_ERROR_STOP=1 -f supabase\rollback\20260101000070_rollback.sql` — 069 dagi aniq funksiyalar,
grantlar va RLS siyosatlarini qaytaradi (lokal sinov: 069 → 070 → rollback imzosi 069 bilan bir xil). Vercel rollback DB’ni
o‘zgartirmaydi.

## Postflight PASS dan keyin
1. Release PR’ni merge qilish → Vercel production deploy.
2. Versiya: `Invoke-RestMethod https://goldia-sales-production.vercel.app/api/version` — `commit` merge commitiga teng bo‘lsin.
3. Direktor panelida: "Sof natija — xarajatlardan keyin" va "Xarajatlardan oldin" qatorlari ko‘rinsin.

## Lokal repetitsiya (izolyatsiyalangan PG16, sintetik ma’lumot)
- Toza 069 bazada: barcha gate PASS → 070 qo‘llandi → postflight 17/17, qator/balans o‘zgarmadi.
- 069 xatolari bilan shikastlangan bazada: accounting gate FAIL → **to‘xtadi**, production o‘zgarmadi.
- 070 qo‘llangandan keyin qayta ishga tushirish: "070 already applied" → to‘xtaydi.
Loglar: `docs/audits/goldia-final-acceptance/evidence/release-rehearsal-070.log`.

## Ma’lum, 070 ga kirmagan masala
- **Sana chegarasi (M-14):** `rpc_set_daily_gold_rate` va sotuv sanasi `CURRENT_DATE` (UTC), foyda/baza esa Toshkent sanasi.
  Toshkent vaqti 00:00–05:00 orasida kiritilgan kurs "kecha"ga yoziladi, baza tasdiqlanmaydi, sotuvlar oldingi kun/oyga tushadi.
  Pilotda shu soatlarda operatsiya qilmaslik; alohida migratsiyada tuzatiladi.
