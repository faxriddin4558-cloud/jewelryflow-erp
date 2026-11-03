# Production 072 → 073 → 074 → 075 — READ-ONLY preflight

**Bu sessiyada production’ga ulanilmagan va hech narsa bajarilmagan.** Quyidagilarni egasi bajaradi; preflight faqat o‘qiydi.

## Fayllar
- `00_preflight_072_to_075_readonly.sql` — bitta READ ONLY tranzaksiya (rollback), har gate uchun `GATE | nom | PASS/STOP/WARN/INFO | tafsilot`, oxirida `RESULT`.
- `gen-preflight.py` — SQL’ni repo imzosidan (`supabase/release/staging-073/expected-072-signature.txt`, PG17 da LF fayllardan qurilgan) qayta yaratadi.
- `evidence/preflight-local-072-copy-PASS.txt`, `evidence/preflight-local-negative-STOP.txt` — lokal PG17 dagi sinov natijalari.

## Gate’lar
| # | Gate | STOP sharti |
|---|---|---|
| 10–13 | JFS demo emas, PG versiyasi, sessiya read-only, tashkilotlar soni | `deployment_environment()` bor; sessiya read-only emas |
| 20–22 | Tarix: 072 yozilgan, 072 dan keyingi versiya yo‘q, repo 001–072 hammasi yozilgan | 072 yo‘q yoki 073+ bor |
| 30–34 | Sxema pariteti repo 001–072 bilan: funksiya/ustun/policy/trigger/RLS yetishmasligi; funksiya tanasi — `identical` / `crlf_only` (INFO) / `DIFFERENT` | biror obyekt yetishmaydi yoki tana haqiqatan farq qiladi |
| 40–46 | 075 sharti: tashkilot ichida takror `customer_code` yo‘q; global unique hozir bor; tashkilotsiz mijozlar; uzun/g‘ayrioddiy kodlar (F-STG-1 hozir productionda buzuqmi); direct INSERT huquqi; factory settings har tashkilotga bitta | takror kod; settings takrori |
| 47–50 | 074/073 ma’lumotlari: tashkilotsiz model/loss config, mavjud bo‘lmagan tashkilot modellari, allocation’siz vazn sotuvlari | — (INFO/WARN) |
| 60–63 | Faollik: boshqa sessiyalar, idle-in-transaction, 60 s dan uzun so‘rovlar, savdo jadvallarida kuchli lock | — (WARN) |
| 70–71 | Snapshot: qatorlar soni va balanslar (keyingi solishtirish uchun, faqat agregat) | — |

Lokal sinov: 072 nusxada `RESULT PASS (0 STOP, 0 WARN)`; 073 yozilgan + bitta tana o‘zgartirilganda `STOP` (`history_nothing_after_072`, `function_bodies_DIFFERENT`);
read-only sessiyada yozish — `cannot execute INSERT in a read-only transaction`.

## Bajarish (PowerShell, parolni psql so‘raydi)
```powershell
git fetch origin claude/goldia-sales-staging-audit-qtrq1d; git checkout --detach FETCH_HEAD
$env:PGOPTIONS='-c default_transaction_read_only=on'
psql "host=aws-0-ap-southeast-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.vrozlllcaxinavzxueif sslmode=require" -X -v ON_ERROR_STOP=1 -A -t -F " | " -f docs/releases/production-075/00_preflight_072_to_075_readonly.sql > PREFLIGHT-075.txt
```
`PREFLIGHT-075.txt` da maxfiy ma’lumot yo‘q (faqat agregatlar).

## Keyingi (egasi qarori bilan, preflight PASS bo‘lsa)
Mavjud gated skript har migratsiyani alohida qo‘llaydi (yangi backup + restore test + lokal nusxada sinov + postflight):
`node scripts/goldia-prod-release.js --migration 073`, keyin `074`, keyin `075` — har biridan keyin postflight PASS bo‘lishi shart.
Release’ni **shu branch’dagi commit’dan** bajaring (`.gitattributes` SQL’ni LF saqlaydi — CRLF tana farqlari paydo bo‘lmaydi).
