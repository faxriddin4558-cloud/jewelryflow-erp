# 073 — Goldia Sales release candidate (production release runbook)

**Holat:** tayyor, production’ga qo‘llanmagan. Faqat egasining alohida ruxsati bilan.
**Migratsiya:** `supabase/migrations/20260101000073_goldia_release_candidate_stabilization.sql` (bitta migratsiya; 072 dan keyin).

## Nima o‘zgaradi
| Qism | O‘zgarish | Ma’lumotga ta’siri |
|---|---|---|
| A | `public._goldia_business_date()` = Asia/Tashkent kalendar sanasi. 16 ta Goldia Sales RPC (refining 2 overload bilan 17 funksiya) va 8 ta hujjat ustuni default’i shu qoidaga o‘tadi | Mavjud qatorlar qayta sanalanmaydi |
| B | `rpc_execute_full_test_reset` sotuvchining 072 valued till pool’ini ham nollaydi | Reset ishlatilmaguncha hech narsa o‘zgarmaydi |
| C | `rpc_record_weight_sale(..., p_piece_ids uuid[])`: shtrix-kodli donasi bor sotuvchi aniq donani tanlamasa, vazn sotuvi rad etiladi; qisman kesish faqat oxirgi tanlangan donada | Yangi sotuvlargagina ta’sir qiladi |

Frontend (bir xil release): vazn sotuvi formasida "Qaysi donadan?" tanlovi; barcha "bugun" sanalari `src/lib/business-date.ts` orqali.

## Release buyrug‘i (Windows PowerShell, repo ildizi, PostgreSQL 17 tools)
```powershell
git fetch origin ccr-fb8951ce-65agfo; git checkout ccr-fb8951ce-65agfo; git pull --ff-only
npm ci --no-audit --no-fund; npm run typecheck
node scripts/goldia-prod-release.js --migration 073
```
Gate’lar (birinchi xatoda to‘xtaydi, production o‘zgarmaydi):
1. Yangi `pg_dump` backup → lokal restore → qator sonlari productionga teng (restore-test).
2. Tiklangan nusxada 073 → postflight → rollback → qayta qo‘llash (compat).
3. READ-ONLY: 072 bor, 073 yo‘q; buxgalteriya tekshiruvi; zarar skaneri (`070_damage_scan_readonly.sql`).
   `REVIEW` bo‘lsa to‘xtaydi; egasi ko‘rib chiqqach `--acknowledge-findings` bilan qayta ishga tushiriladi.
4. 073 + `schema_migrations` bitta tranzaksiyada (`lock_timeout 10s`).
5. Postflight (`supabase/release/073_postflight_readonly.sql`, 12 tekshiruv) + qator sonlari va balanslar o‘zgarmagan.

## Frontend deploy checklist (postflight PASS dan keyin)
1. **Avval DB, keyin frontend:** yangi frontend `rpc_record_weight_sale` ga `p_piece_ids` yuboradi. 073 qo‘llanmagan
   bazada bu chaqiruv xato beradi; eski frontend 073 dan keyin dona tanlamasdan vazn sotuvi qila olmaydi
   (`ERR_PIECE_REQUIRED` — xavfsiz rad etish). Shuning uchun DB va frontend o‘rtasidagi oraliq qisqa bo‘lsin va
   bu oraliqda vazn sotuvi qilinmasin.
2. PR merge → Vercel production deploy → `Invoke-RestMethod https://goldia-sales-production.vercel.app/api/version` (`commit` = merge commit).
3. Brauzerda: sotuvchi menyusi 5 bo‘lim; Mijozlar → "+ Nasiya" → "Vazn bo‘yicha" → "Qaysi donadan?" ko‘rinadi;
   direktor paneli "BALANS TO‘LIQ MOS".
4. Production’da sintetik sotuv yoki reset qilinmaydi.

## Rollback
- DB: `psql "<same connection>" -v ON_ERROR_STOP=1 -f supabase\rollback\20260101000073_rollback.sql` — 072 dagi aniq
  funksiyalar, grantlar va default’larni qaytaradi (lokal: 072 → 073 → rollback imzosi 072 bilan bir xil).
- Frontend: oldingi Vercel deploymentni "Promote". Faqat frontendni orqaga qaytarish 073 DB bilan **mos emas**
  (vazn sotuvi `ERR_PIECE_REQUIRED` beradi) — DB rollback bilan birga qilinadi.

## Lokal repetitsiya (izolyatsiyalangan PG16, 072 + to‘liq ssenariy ma’lumotlari)
Backup, restore-test, compat (+rollback/re-apply), zarar skaneri (REVIEW yo‘q), migratsiya, postflight — PASS;
qator sonlari va balanslar o‘zgarmadi. Log: `docs/audits/goldia-release-candidate-073/evidence/release-rehearsal-073.log`.
