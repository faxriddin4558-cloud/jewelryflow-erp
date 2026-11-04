# Goldia Sales — PRODUCTION release preparation 072 → 073 → 074 → 075 + frontend `fc1a1fa`

**Production:** Supabase `vrozlllcaxinavzxueif`, Vercel `goldia-sales-production` (https://goldia-sales-production.vercel.app).
**Holat (2026-11-04):** faqat tayyorgarlik. Bu sessiyada production’ga **ulanilmagan** (production kaliti/paroli yo‘q, frontend host tarmoqda bloklangan) —
hech qanday production migratsiya, deploy, write RPC yoki ma’lumot o‘zgarishi bajarilmagan. Staging (`vouehtlmsunebracahon`) va JFS Demo (`yvvbdoqncubtwlzskgml`) skriptlarda rad etiladi.

## 0. Preflight xulosasi: **NO-GO (hozircha)** — production preflight hali ishga tushirilmagan
Release uchun hamma vosita tayyor va production shaklidagi 072 stand-in’da to‘liq sinalgan (pastda). GO bo‘lishi uchun quyidagi shartlar bajarilishi kerak.

### Bajarilmagan xavfsizlik shartlari
| # | Shart | Kim |
|---|---|---|
| S1 | `run-readonly-checks.ps1 -Target production` → `RESULT | preflight_072_to_075 | PASS` (0 STOP) va baseline fayli saqlangan | egasi (read-only) |
| S2 | Supabase Dashboard → Database → Backups: **PITR yoqilgan** va oxirgi tiklash nuqtasi release vaqtidan oldin (skrinshot); yoki kunlik backup bugungi | egasi |
| S3 | `scripts/goldia-prod-backup-and-preflight.js --fresh --migration 073` → `ALL AUTOMATED GATES PASS` (yangi pg_dump + lokal restore-test; production faqat o‘qiladi) | egasi (read-only) |
| S4 | `production-frontend.ps1` (CHECK) → `CHECK PASS`: Vercel production env faqat `vrozlllcaxinavzxueif`, staging/JFS/ERP qiymati yo‘q | egasi (read-only) |
| S5 | Release oynasi: savdo to‘xtatilgan, preflight’da `idle_in_transaction=0`, uzun so‘rov yo‘q | egasi |
| S6 | Egasining **yozma ruxsati** production’ga yozishga | egasi |
| S7 | (ixtiyoriy, tavsiya) staging parity: `run-readonly-checks.ps1 -Target staging` → `crlf_only 69`, `DIFFERENT` yo‘q | egasi (read-only) |
| S8 | Production’da 070 damage scan REVIEW qatorlari bo‘lsa — egasi ko‘rib chiqib `--acknowledge-findings` haqida qaror qiladi | egasi |

## 1. Read-only buyruqlar (hozir bajarish mumkin)
Barchasi repo papkasida, PowerShell 5.1/7, release candidate checkout’ida:
```powershell
git fetch origin claude/goldia-sales-staging-audit-qtrq1d; git checkout --detach FETCH_HEAD
# S1 — production preflight + baseline (psql parolni yashirin so'raydi; sessiya read-only)
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production
# S3 — yangi backup + lokal restore-test + 073 ni tiklangan nusxada sinash (production faqat o'qiladi)
node scripts/goldia-prod-backup-and-preflight.js --fresh --migration 073
# S4 — production frontend env tekshiruvi (Vercel'da hech narsa o'zgarmaydi; vaqtinchalik env fayli darhol o'chiriladi)
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\production-frontend.ps1
# S7 — staging 69 function-body parity (read-only)
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target staging -PoolerHost <staging session pooler host>
```
Talablar: PostgreSQL 17 client (`C:\Program Files\PostgreSQL\17\bin`, boshqa joyda bo‘lsa `-PgBin`), Node 20+, Vercel login.
Staging pooler host — staging release hisobotidagi `host=...` qatori (`%USERPROFILE%\GoldiaBackups\goldia-staging-*\STAGING-075-RESULT.txt`).

### Windows PowerShell 5.1 (2026-11-04 tuzatish)
`run-readonly-checks.ps1` va `production-frontend.ps1` BOM'siz UTF-8 edi: PowerShell 5.1 ularni Windows-1252 deb o'qiydi, em-dash (`E2 80 94`)
ichidagi `0x94` qo'shtirnoq bo'lib qoladi -> 46-49-qatorlarda ParserError. Endi ikkala fayl ham **faqat ASCII**; PS 5.1 o'qish simulyatsiyasi
(`harness/ps51-parse-check.ps1`, faylni cp1252 sifatida dekodlab parse qiladi) - 0 xato (`evidence/run-readonly-checks-tests/ps51-parse-simulation.txt`).
`run-readonly-checks.ps1`: psql `System.Diagnostics.Process` orqali, exit code va natija qatori tekshiriladi; parol bir marta yashirin so'raladi va faqat
psql jarayoni muhitiga beriladi; `RESULT: PASS` (0) / `REVIEW` (2, WARN) / `FAIL` (1) - har qanday ulanish/SQL xatosi, STOP, natija qatori yo'qligi yoki
parity farqi FAIL. Lokal PG17 bilan xatti-harakat testlari **13/13** (`harness/test-run-readonly-checks.sh`, `evidence/run-readonly-checks-tests/`).

## 2. Nima tekshiriladi
| Hujjat | Mazmun |
|---|---|
| `00_preflight_072_to_075_readonly.sql` | JFS emas, PG17, read-only sessiya; tarix: 072 bor, 073+ yo‘q, 001–072 to‘liq; sxema pariteti repo 001–072 bilan (CRLF’ga chidamli: `crlf_only` INFO, haqiqiy farq STOP); 073–075 konfliktlari: tashkilot ichida takror `customer_code` (075 constraint), tashkilotsiz mijozlar, uzun kodlar (F-STG-1 production’da hozir buzuqmi), factory settings takrori, tashkilotsiz model/loss config (074), allocation’siz vazn sotuvlari (073); faollik (sessiyalar, idle-in-transaction, uzun so‘rov, kuchli lock); WAL/PITR ishorasi; agregat snapshot |
| `01_baseline_readonly.sql` | Har tashkilot: mijoz qarzi/avansi, sotuvchi majburiyati/qarzi/qo‘ldagi oltin/kassa (so‘m, USD, lom, 072 qiymatlangan pool), menejer ombori/so‘m/USD, zavod majburiyati va qabul qilingani, faol savdo/to‘lov/kirim, qo‘ldagi donalar; jami qatorlar; har jadval qatorlari soni; **biznes fingerprint** (md5) |
| `production-frontend.ps1` | Vercel production env: URL, APP_ENV, STAGING_MODE, ikkala kalit JWT `ref`, anon kalit production Auth’da; jonli `/api/version` |

Natijani solishtirish (release’dan keyin): `Compare-Object (Get-Content before\01_baseline.txt) (Get-Content after\01_baseline.txt)` — faqat `history latest` / `history count` farq qilishi kerak.

## 3. Lokal rehearsal (production shaklidagi 072 stand-in, PG17 + GoTrue; 60 tashkilot, 200 login, ekilgan uzun kod)
| Qadam | Natija | Dalil |
|---|---|---|
| Preflight | `RESULT PASS (0 STOP, 0 WARN)`; F-STG-1 hozir buzuq (uzun kod bor) — INFO | `evidence/preflight-local-072-copy-PASS.txt` |
| Preflight negativ | 073 yozilgan + tana o‘zgargan → `STOP` ×2; read-only sessiyada INSERT → rad | `evidence/preflight-local-negative-STOP.txt` |
| Baseline | 140 qator + fingerprint | `evidence/baseline-local-072-standin.txt` |
| `goldia-prod-backup-and-preflight.js --fresh --migration 073` | backup VERIFIED (68 jadval, qatorlar mos), 073/074/075 tiklangan nusxada PASS, rollback+re-apply ok | `evidence/prod-script-rehearsal/*SUMMARY.txt` |
| `goldia-prod-release.js` 073 → 074 → 075 | 1-urinish: 073 da **070 damage scan REVIEW** (`D11_organizations=60`, stand-in’da 60 tashkilot) → STOP; 074/075 → oldingi yo‘q → NO-GO (to‘g‘ri). `--acknowledge-findings` bilan: har biri **APPLIED, POSTFLIGHT PASS**, qatorlar va balanslar o‘zgarmagan | `evidence/prod-script-rehearsal/*RELEASE-07x-RESULT.txt` |
| Baseline 072 vs 075 | faqat tarix qatorlari farq qiladi; biznes fingerprint bir xil | — |
| Rollback 075 → 074 → 073 | sxema **aynan 072 imzosi**, biznes baseline o‘zgarmagan | — |
| Favqulodda rollback (tarix bilan) | noto‘g‘ri tartib → STOP; to‘g‘ri tartib → tarix 074/073/072; takror → STOP; keyin preflight yana PASS | `emergency/` |

## 4. Bu bosqichda tuzatilgan release xavflari (production’ga tegmasdan)
| # | Xavf | Tuzatish |
|---|---|---|
| R1 | `goldia-prod-release.js --migration 075` to‘xtardi: 075 postflight yozuvi yo‘q edi | `"075"` postflight qo‘shildi |
| R2 | `goldia-prod-release.js` gate’lardan keyin production’ga **tasdiqsiz** yozardi; staging/JFS ref guard yo‘q edi | production ref’ini qo‘lda yozish majburiy; staging/JFS/ERP ref’lari ulanishdan oldin rad; `--local-rehearsal --yes` faqat lokal host’da |
| R3 | `supabase/rollback/07x` fayllari `supabase_migrations` tarix qatorini o‘chirmaydi → favqulodda rollback’dan keyin tarix sxemaga mos kelmaydi | `emergency/rollback_07x_with_history.sql` — rollback + tarix qatori bitta tranzaksiyada, tartib guard’i bilan |
| R4 | `env.production.example` va `scripts/preflight-real-supabase-audit.js` da production ref xato (`vrozlilcaxinavzxueif`) | tuzatildi |
| R5 | `scripts/sync-vercel-prod-env.js` `.env.production.local` ni ref tekshiruvisiz Vercel’ga yuboradi | ishlatmang; `production-frontend.ps1` env’ni tekshiradi (o‘zgartirmaydi) — qiymatlar Vercel dashboard’da qo‘yiladi |

## 5. Release rejasi (egasining yozma ruxsatidan keyin)
1. S1–S6 bajarilgan; release oynasi e’lon qilingan; sotuvchilar operatsiya qilmaydi.
2. `node scripts/goldia-prod-release.js --migration 073` → har safar yangi backup + restore-test + tiklangan nusxada sinov → gate’lar → **ref’ni yozib tasdiqlash** → bitta tranzaksiya → postflight, qatorlar/balanslar o‘zgarmagan. Natija: `RELEASE-073-RESULT.txt`.
3. Xuddi shunday `--migration 074`, keyin `--migration 075`.
4. `run-readonly-checks.ps1 -Target production` qayta: preflight endi tarix gate’ida STOP beradi (075 yozilgan — kutilgan), baseline’ni release oldidagisi bilan solishtiring (faqat tarix farq qiladi).
5. Frontend: Vercel production env `production-frontend.ps1` bilan PASS; keyin `production-frontend.ps1 -Apply -ReleaseCandidate <frontend sha>` (ref’ni yozib tasdiqlash). Frontend kodi = `fc1a1fa` (keyingi commit’lar faqat docs/scripts).
6. Smoke (production, egasi): direktor/menejer/sotuvchi login, `/api/version`, sotuvchi to‘lov oynasida o‘z kursi, bitta haqiqiy mijoz yaratish (kod o‘z tashkilotida ketma-ket).

## 6. Recovery rejasi (darajalar bo‘yicha)
| Holat | Harakat | Ma’lumot yo‘qolishi |
|---|---|---|
| Migratsiya tranzaksiyasi xato | PostgreSQL o‘zi rollback qiladi; production o‘zgarmagan | yo‘q |
| Postflight FAIL / xatti-harakat xato (savdo boshlanmagan) | `emergency/rollback_075_with_history.sql`, kerak bo‘lsa 074, 073 (shu tartibda, `--single-transaction`) | yo‘q (biznes qatorlari saqlanadi) |
| 075 rollback “REFUSED” (075 dan keyin ikki tashkilotda bir xil kod paydo bo‘lgan) | Rollback qilinmaydi; oldinga tuzatish (forward fix) yoki PITR | — |
| Frontend xato | Vercel → Deployments → oldingi production deployment → **Instant Rollback** | yo‘q |
| Ma’lumot buzilishi | **PITR** (Supabase Dashboard → Backups → Point in Time) release boshlanishidan oldingi vaqtga | release’dan keyingi barcha yozuvlar |
| PITR mavjud emas | `goldia-prod-backup-and-preflight.js` dump’ini yangi loyihaga tiklash (restore-test bilan tekshirilgan) | dump’dan keyingi yozuvlar |

## 7. Frontend’ga staging kalitlari tushib qolmasligi
- Repo’da (src, public, next.config, package.json) staging/JFS/production ref’i yoki JWT **yo‘q**; Supabase URL va kalitlar faqat `NEXT_PUBLIC_*` env’dan, build vaqtida Vercel production env’idan olinadi.
- `production-frontend.ps1` env’ni (URL, APP_ENV, STAGING_MODE, JWT `ref`, anon kalit production Auth’da) va jonli `/api/version` ni tekshiradi; `-Apply` muammo bo‘lsa deploy qilmaydi.
- `deploy-staging-frontend.ps1` faqat `jewelryflow-sales-staging` va staging ref’ini qabul qiladi.
