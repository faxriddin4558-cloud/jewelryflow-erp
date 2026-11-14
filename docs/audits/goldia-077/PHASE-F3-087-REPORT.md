# PHASE F3: backup verification inside the freeze, migration 087 (2026-11-14)
Production untouched (DB 085, frontend 1030631). Staging untouched (DB 086; org D still frozen since 13.11 12:04 UTC,
0 verifications, 0 restarts). 087 built and tested locally only.

## Answers
| Question | At 086 | With 087 |
|---|---|---|
| 1. Two verifications for one backup = replay risk? | **Yes.** Each row is single-use, but the spare row stays valid for 24 h. After restart 1 -> opening -> lock (the freeze ends) -> ordinary work -> a new freeze, the spare row is accepted for restart 2 although the backup does not contain anything done since. | Refused: ERR_BACKUP_BEFORE_FREEZE (the spare row is older than the new freeze). Staging tool: exactly one row per backup (`--verify-count` other than 1 = STOP). |
| 2. How does the server know the verification belongs to a backup taken inside the freeze? | **It does not.** It checks only restore_verified, unconsumed, < 24 h. A verification written before the freeze was accepted (proved on real PG, GAP-086). | The restart gate requires `verified_at >= frozen_at` of the active freeze. The dump time itself is not visible to the server: the tooling (service role only can write verifications) guarantees it. The staging tool now reads the freeze BEFORE the dump and writes the row only if the same freeze is still active; the production tool already refuses a backup without a freeze and compares the fingerprint before / after the dump and before the row. |
| 3. After restart 1, is a restart with the second verification blocked? | Only while the opening is a draft (085: ERR_RESTART_ALREADY_OPEN). After the lock + a new freeze: **not blocked**. | Blocked (ERR_BACKUP_BEFORE_FREEZE). Defence in depth: ERR_FREEZE_ALREADY_USED = one restart per freeze, even if a draft were removed. |
| 4. Minimal server-side fix needed? | Yes. | 087 = one function body (public._goldia_guard_restart_t0), no table, grant or business row. |

## Second finding (release blocker, fixed)
The 086 postflight column `nothing_frozen` is false as soon as any freeze exists (staging org D now, production after its
first restart window). Every later release would have stopped at the postflights. Replaced by `freeze_rows_consistent`
(at most one active freeze per organization, every release after its start, every row of an existing organization).
Postflight file only; no schema change.

## 087
* `supabase/migrations/20260101000087_goldia_backup_inside_freeze.sql`: the 086 rules unchanged and first (freeze required,
  T0 future / 24 h / 1 h before the freeze, Asia/Tashkent wording), then ERR_BACKUP_BEFORE_FREEZE and ERR_FREEZE_ALREADY_USED.
* Rollback `supabase/rollback/20260101000087_rollback.sql` restores the 086 body byte for byte; it touches no freeze or
  restart history.
* Release kit: 087_postflight_readonly.sql, POSTFLIGHT_CHECKS["087"], emergency/rollback_087_with_history.sql,
  expected-087-signature.txt (diff from 086: exactly one function hash), function_body_parity_087_full_readonly.sql.
* Tools:
  * staging `--backup-only --verify-org`: org must be frozen before the dump, same freeze when the row is written, exactly 1 row;
  * production goldia-prod-opening-backup.js: requires history 087;
  * run-readonly-checks production-opening-recon: accepts 087.

## Local tests
| Test | Result |
|---|---|
| vitest full | **52 files / 456 tests PASS**, tsc clean. New 087 suite 6/6: G1 verification before the freeze refused; G2 inside the freeze OK (T0 rule first); G3 spare verification replay refused; G4 backup of an aborted freeze refused; G5 one restart per freeze; G6 no user write path. The 085 suites now take the backup after the freeze (the correct order; before, they wrote it first and 087 refused that) |
| real PG 17 (gap-087-realpg.json) | 4/4: GAP-086 accepted at 086 (the gap), FIX-087 refused at 087, postflights 085-087 true with a freeze + restart present |
| fresh 087 stack | postflights 085 / 086 / 087 true; emergency rollback -> exact 086 signature; re-apply -> exact 087 |
| staging kit, staging shape (086, 46 CRLF, one synthetic org FROZEN like D) | dry run PASS, `--apply` PASS (postflights 073..087, RLS, counts / balances unchanged, freeze kept), rerun UP TO DATE |
| staging `--backup-only` | `--verify-count 2` STOP; unfrozen org STOP (nothing written); frozen org: 1 row, written after the freeze; director restart with it: ok |
| production kit, production shape (085, 60 orgs, 58 CRLF) `--expect-level 085` | chain 086 -> 087 ALL GATES PASS: parity 128 + 58 crlf_only / 0 different, fingerprint unchanged, rollback to exact 085, re-apply, postflights 073..087, RLS PASS |
| production opening-backup tool at 087 | backup without freeze STOP; freeze; backup + verification inside the freeze; restart with it: ok |

## Verdict
* Writing verification rows for staging D now (at 086): **NO-GO**.
* Staging 086 -> 087 (owner runs it): **GO**.
* Production: target 085 -> 087 in one gated release (never 086 alone): **NO-GO until the staging D integration passes at 087**.
* Production restart: **NO-GO**.
