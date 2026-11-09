# Goldia Sales 081 — staging Auth blocker + real-staging verification

Date 2026-11-09. Staging `vouehtlmsunebracahon`: DB **081** (history 81 rows; 057 / 058 repaired), frontend **28596c3**
(`sha_source=build`). Production, JFS demo, ERP: **not touched**. Writes only in the synthetic organizations
GOLDIA-AUDIT-075-A / B, real GoTrue JWTs through PostgREST and the real staging site (Playwright).
Evidence: `evidence/staging-081/`.

## 1. Auth blocker (smoke `invalid_credentials` for director@ / manager@ / seller@goldia.uz)
| Check (read only) | director@ | manager@ | seller@ |
|---|---|---|---|
| exists, not deleted | yes | yes | yes |
| banned_until | null | null | null |
| e-mail confirmed | yes | yes | yes |
| identities | 1 (email) | 1 (email) | 1 (email) |
| employee in "Goldia Jewelry Demo Staging" | admin, active | production_manager, active | sales, active |
**Verdict: not blocked, link intact** → `invalid_credentials` = the typed password differs from the stored one
(director's Auth row last updated 2026-11-04; no script of this repository touches these accounts). Nothing was changed
on them. New passwords: the owner runs `docs/releases/staging-075/reset-staging-test-passwords.ps1` (below).

`reset-staging-test-passwords.ps1` (new): staging only (key must be the staging service_role JWT; production / JFS / ERP
refused), only accounts of "Goldia Jewelry Demo Staging", passwords + key typed hidden, min. 12 characters, typed twice,
never printed / written; proves each new password with a real login (token `sub` = that account); `-Unban` optional.
Local tests (`evidence/staging-081/` not needed — results here): banned without `-Unban` → FAIL (login 400), `-Unban` →
PASS, account not in the demo organization → STOP, short password → STOP, anon key → STOP, test switch on the real target
→ STOP, non-local URL → STOP; output contains neither password nor key (0 matches). PS 5.1 parse 0 errors, ASCII only.

## 2. Real staging Auth (synthetic accounts, unbanned for the run, banned again)
director, manager, sellera, sellerb, directorB, managerB, sellerB1: **login PASS**, role `authenticated`, employee linked;
`noemp` login PASS without employee (expected). After the run: 36 / 36 synthetic users banned, logins refused (400).

## 3. Results on 081
| Suite | Result |
|---|---|
| 081 seller advance (`adv-081`): advance for a customer without debt (UI, double click → 1 row); open debt → no button + server refusal; other seller / org / target balance / reversal refused; 8 parallel → 1; advance used by the next sale; manager reverses in the UI; director = manager | **11/11** |
| director = manager parity matrix (every write RPC) | **0 mismatches** (test reset director-only = D-P1) |
| 077 targeted (report boundaries, reclassification, employee id ≠ auth uid) | **25/25** |
| 077 UI (UZS / USD sales, currency payments, period report page) | 19/21 → harness timing fixed → **21/21** |
| 078 extra / 078 archive UI | **17/17** / 9/10 → harness timing fixed → **10/10** |
| 079 D-A1 / D-A2 | **14/14** |
| 080 period report | **8/8** |
| currency stress | **13/13** |
| 076 API / 076 UI | **57/57** / **17/17** |
| 076 stress | 15/16 → harness model fixed → **16/16** |
| integrity (9 sellers, 2 054 pieces, 2 588 sales, 3 396 allocations) | PASS |
| independent reconciliation (final, after all writes) | **5/5**: currency 270 customer × currency 0 mismatches; stock = held pieces 2 613.034 g; 585 opening 0 + flows 7 977.2396 = closing = live; seller obligation 530 rows 0.0000; no negative balance |

### The three first-run shortfalls — all harness, none product
* **U77-14 / U77-20**: the currency modal loads balances, history and then the seller's rates; the harness read the rate
  line after a fixed 1.5 s and saw "USD belgilanmagan". The server refused nothing wrongly — nothing was saved (till and
  debt unchanged, i.e. safe). U77-20 depended on U77-14. Fix: wait for the rates line. Re-run 21/21.
* **U78-10**: the restore click on the 390 px archived list landed during a re-render (no request, no API error). Fix:
  wait for the button and for the server answer. Re-run 10/10.
* **REC-LEG-sellerc**: the database obligation (200.173 g) = max(0, sum of the 22 active debt deltas) exactly; an earlier
  suite had left a −1.000 g reduction, so the stored obligation was correctly clamped at 0 before the stress run and the
  model (started from the clamped value) was 1 g high. Fix: the model starts from the unclamped sum. Re-run 16/16.

## 4. Verdict
Staging 081: **PASS**. Open owner step: new passwords for the three demo accounts with the script above, then the
staging smoke. Production: unchanged, see `PRODUCTION-DRIFT-AUDIT.md`.
