# Staging 075 parity: “69 function bodies differ” — tahlil

## Xulosa
69 ta farq **Windows qator oxirlari (CRLF)** sababli: release Windows checkout’dan bajarilganda (`core.autocrlf=true`) 063–075 migratsiyalaridagi
har bir ko‘p qatorli funksiya tanasi `prosrc` ichida `\r` bilan saqlanadi. `signature.sql` `md5(prosrc)` ni taqqoslaydi, shuning uchun hash farq qiladi.
**Xavfsizlik va hisobga ta’siri yo‘q** (kod bir xil, faqat `\r` — PL/pgSQL va SQL uchun bo‘sh joy).

## Dalillar
| Dalil | Natija |
|---|---|
| 063–075 da (qayta) yaratilgan funksiyalar | **69 nom** (70 signatura) — farqlar soni bilan mos |
| Lokal PG17: 001–062 LF, 063–075 CRLF bilan (`harness/crlf-repro.sh`) → `expected-075` bilan solishtirish | **aynan 69 ta H qatori farq**, F/C/P/T (funksiya, ustun, policy, trigger, RLS) — **0 farq**. Bitta qatorli tana (`_goldia_business_date`) `\r` olmaydi — shuning uchun 70 emas, 69 |
| `supabase/release/function_body_parity_075_readonly.sql` shu bazada | `crlf_only 69`, `identical 88`, `DIFFERENT 0` |
| Nazorat: bitta funksiya tanasi haqiqatan o‘zgartirildi | `DIFFERENT 1` — skript haqiqiy farqni ushlaydi |
| Butun vitest to‘plami 063+ migratsiyalari CRLF bilan (`GOLDIA_TEST_CRLF_FROM=20260101000062`; 69 funksiyada `\r` borligi tekshirildi) | **346/346** (LF bilan ham 346/346) — RLS, moliyaviy, concurrency testlari bir xil |
| Staging’dagi xatti-harakat | 732 API operatsiyasi + UI operatsiyalari repo kutilmalariga aynan mos (0.0000 g) |
| Qator oxiriga bog‘liq mantiq (chr(10)/chr(13)/E'\n'/split) 063–075 funksiyalarida | topilmadi |

## Staging’da tasdiqlash (READ ONLY, egasi bajaradi)
```powershell
$env:PGOPTIONS='-c default_transaction_read_only=on'
psql "host=<staging session pooler> port=5432 dbname=postgres user=postgres.vouehtlmsunebracahon sslmode=require" -X -v ON_ERROR_STOP=1 -A -t -F " | " -f supabase/release/function_body_parity_075_readonly.sql
```
Kutilgan: `crlf_only | 69`, `DIFFERENT` qatori yo‘q. Agar `DIFFERENT` chiqsa — o‘sha funksiyalar alohida ko‘rib chiqiladi (bu sessiyada staging’ga SQL ulanishi yo‘q, shuning uchun men bajara olmadim).

## Oldini olish
`.gitattributes`: `*.sql text eol=lf` — Windows checkout’da ham SQL fayllar LF bo‘lib qoladi; production release shu commit’dan bajarilsa, bunday farq paydo bo‘lmaydi.
Production preflight (`docs/releases/production-075/`) tana farqini CRLF’ga chidamli tekshiradi: `crlf_only` — INFO, haqiqiy farq — STOP.
