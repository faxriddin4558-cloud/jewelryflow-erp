# PHASE F3: 086 security audit + staging release preparation (2026-11-13)
Production untouched (DB 085, frontend 1030631). Staging NOT deployed (still 085). Everything below ran locally.

## 1. Freeze coverage and bypass audit
| Check | Result |
|---|---|
| Ordinary financial write RPCs | every Goldia Sales write RPC writes at least one of the 12 guarded tables (jewelry_sales, jewelry_sale_returns, gold_settlements, client_currency_settlements, client_legacy_debts, seller_consignments, consignment_pieces, factory_receipts, factory_gold_handovers, refining_batches, financial_transactions, gold_purchases) -> ERR_FINANCIAL_FREEZE (test F2: seller, manager, director; direct service-role table insert refused too) |
| Writer outside the 12 tables #1: rpc_record_manager_seller_settlement | writes seller / manager balances, but its table public.manager_seller_settlements does not exist (no migration creates it; also absent on staging) -> every call fails and rolls back, balances unchanged. Test F7. No bypass. Documented in 086 |
| Writer outside the 12 tables #2: accounting_baselines (rpc_confirm_accounting_baseline) | **gap found and fixed**: a baseline could be confirmed between backup and restart. 086 now has trg_goldia_baseline_freeze: during a freeze a baseline is only allowed to lock the restart's draft opening. Test F8 |
| Derived writes by read RPCs (client_gold_accounts via ledger / register_or_get_customer) | caches only, recomputed from the ledger; backup tool fingerprint ignores updated_at so they do not raise false alarms |
| ERP manufacturing tables (gold_transactions, inventory_items, orders, debt_repayments, sales) | outside the Goldia Sales ledger and the restart; not frozen on purpose |
| `goldia.opening_write` bypass | set ONLY inside rpc_financial_restart, rpc_record_opening_document, rpc_cancel_opening_document, and equals txid_current() (a value set by a user in another transaction does not match). No exposed function runs dynamic SQL or set_config for users; `set_config` from PostgREST is impossible (no RPC). Restart itself requires an active freeze (ERR_FREEZE_REQUIRED, F1) |
| Freeze control | _goldia_financial_freeze: service_role / owner only; authenticated gets permission denied (F3); freeze table: authenticated read own org only, no write |
| Races (real PG 17, separate connections) | race-086 4/4: freeze waits for an in-flight writer; 20 parallel writes -> committed only before frozen_at (0 rows younger); restart inside the freeze OK while 8 writes refused, other org works; writer > lock_timeout -> clean failure, no freeze row, retry OK |
| freeze -> backup -> verification -> restart -> baseline | backup tool refuses --backup unless frozen; verification consumed once (085); restart needs freeze + valid T0; baseline inside a freeze only for the draft opening; locking the opening ends the freeze automatically |
| T0 on the server (Asia/Tashkent) | BEFORE INSERT on financial_restarts: ERR_T0_FUTURE (> now+1 min), ERR_T0_TOO_OLD (> 24 h), ERR_T0_BEFORE_FREEZE (> 1 h before the freeze: wrong browser time zone). Messages in Tashkent time. Frontend sends the Tashkent wall clock as +05:00 (business-date tests under 3 TZs). Test F4 |
| Rollback 086 | refuses if ANY freeze row exists (so freeze / restart history is never destroyed); restores the 085 guard byte for byte; rollback -> exact 085 signature, re-apply -> exact 086 |

## 2. Local tests
| Test | Result |
|---|---|
| vitest full | **51 files / 450 tests PASS** (086 suite 9/9: F0-F8), tsc clean |
| race-086-freeze.js on 086 stand-in | **4/4 PASS** (evidence/phase-f3/race-086.json) |
| staging kit, staging-shaped stand-in (085, seeded, 46 CRLF bodies) | dry run PASS (backup + SHA256 verified, restore identical, copy 085->086, postflights 073..086 true, RLS read/write PASS, emergency rollback 086 OK, re-apply OK); `--apply` PASS (one transaction, history 086, balances / row counts unchanged, RLS PASS); rerun -> **UP TO DATE (086), only read** |
| production kit, production-shaped stand-in (60 orgs, currency data, 58 CRLF) `--expect-level 085` | **ALL AUTOMATED GATES PASS**: parity 128 identical + 58 crlf_only / 0 different, 85-category fingerprint unchanged, rollback to exact 085, re-apply, postflights 073..086 true, RLS PASS (evidence/phase-f3/prod-kit-085-086-rehearsal.txt) |

## 3. Staging release command (owner, own computer; I did NOT run it)
Staging script safety: only ref vouehtlmsunebracahon is accepted (production / JFS demo refused before connecting); typed ref confirmation; full backup + SHA256 + local restore + copy rehearsal + rollback / re-apply BEFORE touching staging; Vercel step only project jewelryflow-sales-staging with RequireMigration = 086.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target staging
```
(Run from your normal repo folder; it creates its own worktree from branch claude/goldia-sales-077-parity-period-currency at the pushed head. Send me the logs it prints: dry run result, apply result, frontend /api/version, smoke.)

## 4. Production 085 -> 086 risks
* Production has 58 CRLF function bodies: handled (CR-tolerant parity), rehearsed.
* Applying 086 does not freeze anything and writes no business row; ordinary work continues.
* After 086, a restart is impossible without a freeze: the opening procedure must use the tool (`--freeze` first).
* A freeze set by mistake stops all Goldia Sales money / gold writes of that organization until `--release-freeze` - only the tool can set it.
* Rollback of 086 is refused once any freeze happened (by design): after the first freeze, fixes go forward only.
* lock_timeout 30 s: a very long writer makes the freeze fail cleanly; retry.

## 5. Remaining blockers before a production restart
1. Owner runs the staging release (section 3) and sends logs.
2. Staging integration in a NEW synthetic org (approval needed): freeze -> backup -> verification -> restart -> opening -> baseline -> unfreeze; 20 parallel writes; roles; direct RPC bypass; old gram/UZS/USD debts; seller / factory obligations; D-1..D-6; 077-085 regression; UI time zones + 390px; fingerprint of other orgs; then ban synthetic users and revoke only their sessions. A, B, Demo untouched.
3. Production 085 -> 086 release (separate approval, same gated path).
4. Read-only production-opening-recon reviewed, opening template filled, T0 and stop-work window fixed, sellers hand over cash / LOM.
5. Restart window itself (separate approvals: freeze+backup, restart, openings, baseline).

Verdict: local **GO**; staging **waiting for the owner's run**; production restart **NO-GO**.
