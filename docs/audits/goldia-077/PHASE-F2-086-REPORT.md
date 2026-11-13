# PHASE F2 final safety fix: migration 086, server-side write freeze + server-side T0 (2026-11-13)
Production untouched (DB 085, frontend 1030631). Everything ran locally: PGlite unit tests, a real PostgreSQL 17 stand-in
for the races, and the production release kit in --local-rehearsal.

## 1. Is 086 needed? Yes (proved)
* 085's draft guard refuses ordinary writes only AFTER the restart: `goldia.opening_write` marks the restart / opening
  transactions, and `opening_periods.status = 'draft'` exists only after the restart.
* Unit test F0: after a backup verification an ordinary write is still accepted at 085. The `--watch` of the tool could only REPORT it.
* So the window "backup -> restart" was protected by procedure only.

## 2. Minimal 086 design (supabase/migrations/20260101000086_goldia_financial_write_freeze.sql)
| Part | What |
|---|---|
| financial_write_freezes | one ACTIVE freeze per organization (partial unique index); RLS: members read their own organization only; no write for authenticated / anon |
| _goldia_financial_freeze(org, reason, on) | release tooling only (owner / service_role; refused for authenticated). ON: takes the EXCLUSIVE per-organization restart lock (lock_timeout 30 s), so every writer already past the guard commits first; frozen_at = clock_timestamp() after that; audited (FINANCIAL_FREEZE_ON / OFF) |
| _goldia_guard_opening_draft (only changed 085 function) | same 085 rules + one refusal: `ERR_FINANCIAL_FREEZE` while a freeze is active. Restart and opening transactions still pass first (same 085 mark), on the same 12 tables / triggers |
| automatic end | a freeze ends when an opening period created after it is LOCKED (baseline confirmed): ordinary work resumes with no extra step |
| explicit end | _goldia_financial_freeze(org, reason, false): abort before the restart or after a failed one (the restart is one transaction, so a failure changes nothing and the freeze simply stays) |
| restart gate + T0 | BEFORE INSERT trigger on financial_restarts (rpc_financial_restart itself unchanged). It refuses, and the whole restart rolls back, when: no active freeze (ERR_FREEZE_REQUIRED); T0 > now + 1 min (ERR_T0_FUTURE); T0 < now - 24 h (ERR_T0_TOO_OLD); T0 more than 1 h before the freeze (ERR_T0_BEFORE_FREEZE; a browser in another time zone). Messages show Asia/Tashkent times |
| other organizations | everything is per organization_id: no effect |

Business rules unchanged:
* a customer's debt goes into HIS seller's obligation;
* unsold goods (B) and sold-goods debts (E / F) are never counted twice;
* the factory obligation is separate.
These are the 085 functions, untouched, and the 085 suites still pass.

## 3. Minimal diff
* Schema signature 085 -> 086: + table (8 columns, 1 policy, RLS), + 3 functions, + 1 trigger, and ONE changed existing body (_goldia_guard_opening_draft). Nothing else.
* Release kit:
  * rollback 086 (restores the 085 guard byte for byte; refused once a freeze exists);
  * emergency/rollback_086_with_history.sql;
  * 086_postflight_readonly.sql;
  * POSTFLIGHT_CHECKS["086"];
  * expected-086-signature.txt;
  * function_body_parity_086_full_readonly.sql.
* Tooling:
  * scripts/goldia-prod-opening-backup.js: requires history 086; `--freeze` / `--release-freeze` (typed ref + organization code); `--backup` refused unless frozen; the quiet window is information only inside the freeze.
  * run-readonly-checks production-opening-recon accepts 085 / 086.
* Frontend (OpeningAccountingSection, business-date.ts):
  * T0 is a Tashkent wall clock, sent as +05:00;
  * the freeze state is shown;
  * the restart button needs an active freeze and a T0 that passes the same rule as the server.
* Tests adjusted, not weakened: the three 085 suites freeze before their restarts and use a T0 of "now - 1 min" (their fixed 2026-11-11 T0 would now be refused as > 24 h old).

## 4. Tests
| Test | Result |
|---|---|
| vitest full | **51 files, 448 tests PASS**; new goldia-086-write-freeze 7 / 7 (F0 gap at 085, F1 no freeze -> refused, F2 all roles + direct table write refused / other org works, F3 permissions + RLS, F4 T0 future / old / time-zone refused, F5 restart + openings pass, lock ends the freeze, F6 explicit release + audit); business-date 16 / 16 under 3 time zones |
| race-086-freeze.js (real PG, separate connections) | **4 / 4**: RACE-1 the freeze waits for a writer inside its transaction (about 2.1 s), the next write is refused; RACE-2 20 parallel writes: committed only before the freeze moment or refused, 0 rows younger than frozen_at; RACE-3 restart inside the freeze OK, 8 parallel writes refused, other organization works; RACE-4 a writer longer than lock_timeout -> clean failure, no freeze row, retry OK |
| fresh 086: postflight 086 / 085 | all true |
| rollback 086 | signature = expected 085 exactly; re-apply = expected 086; refused when a freeze exists |
| production release kit, local rehearsal 085 -> 086 (production shape: 60 orgs, currency data, 58 CRLF bodies) | **PASS**: backup + restore identical, copy chain + postflights 073..086, emergency rollback to an exact 085, re-apply, chain in one transaction, balances / 85-category fingerprint unchanged, parity 127 + 58 crlf_only / 0 different, RLS PASS |
| backup tool with the freeze (evidence/phase-f2-086) | T1 backup without freeze STOP; T2 freeze ON; T3 ordinary write refused ERR_FINANCIAL_FREEZE; T4 backup + verification inside the freeze; T5 restart; watch CLEAN; T6-T9 freeze ON -> write refused -> release -> write OK |

## 5. Staging test plan (needs approval; staging writes only in org C / a new synthetic org)
1. Staging release 085 -> 086 with goldia-release.ps1 -Target staging: dry run, apply, frontend, read-only smoke. The commit containing 086.
2. In a fresh synthetic org (C is locked; it may be restarted again only after a new freeze):
   1. `_goldia_financial_freeze` via service role;
   2. ordinary write refused;
   3. owner backup-only + 2 verification rows;
   4. OP-1..OP-10 (harness updated: freeze before each restart, T0 now - 5 min);
   5. race-086 against the synthetic org;
   6. T0 time-zone refusal through the UI.
3. Invariants of every other organization identical (as in PHASE D); C accounts re-banned, sessions revoked.

## 6. Verdict
* Local: **GO**.
* Staging: **NO-GO until the staging run in section 5 is approved and passes**.
* Production restart: **NO-GO**.

Pre-restart checklist (each a separate approval):
1. Staging 086 release + section 5 PASS.
2. Production release 085 -> 086 (same gated path: prelaunch, backup, copy chain, rollback rehearsal, one transaction, postflight, frontend, smoke).
3. Read-only production-opening-recon reviewed; template confirmed; T0 and the stop-work window fixed; sellers hand over money and LOM.
4. Restart window:
   1. tool `--freeze` -> `--backup --write-verification` -> `--watch --expect`;
   2. director restart (T0 Tashkent);
   3. opening documents;
   4. reconciliation green;
   5. lock (the freeze ends automatically).
5. Abort at any point before the restart: `--release-freeze`.
