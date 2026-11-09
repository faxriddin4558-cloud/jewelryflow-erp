# Goldia Sales — 081 release safety correction (level detection, version-gap STOP)

Date 2026-11-09. Production (`vrozlllcaxinavzxueif`), JFS demo and the manufacturing ERP: **not touched** (not even read).
Staging: **read only** (plain SELECTs). All writes: the local disposable stand-in only.

## 1. Real staging level (read only) — `evidence/staging-081-preflight/staging-history-readonly.txt`
* Staging is at **080**, not 076: 077, 078, 079, 080 recorded; 081 not applied (076 legacy rule still in place); postflights 076–080 all true.
* **Finding F81-1 (MEDIUM, release tooling):** history rows of **057 and 058 are missing** on staging although their
  objects exist (factory advance columns, `capital_pure_gold` source type) and all 168 function bodies equal repository
  080 up to Windows CR (aggregate md5 identical). The old staging script only *printed* such gaps and continued
  (evidence: `docs/releases/staging-073/evidence/negative-tests.txt` N6 → DRY RUN PASS).
* **Finding F81-2 (HIGH, release tooling):** `goldia-release.ps1` defaulted to "only the newest migration" (081). On a
  database at 076 that would have been refused by the release scripts' exact-level gate, but the orchestrator did not
  plan the real chain; and the 081 prelaunch kit (`07`) accepted only history 080, so a 076 → 081 production chain
  would have STOPPED at that kit.

## 2. Fix (commit on `claude/goldia-sales-077-parity-period-currency`)
* `scripts/lib/goldia-level.js` (new): level = newest recorded version; plan = every repository migration after it.
  STOP on empty history, recorded version unknown to the checkout, database newer than the checkout, repository
  numbering gap, **version gap**. A gap passes only with `--repair-history <exactly the missing numbers>`.
* `scripts/lib/goldia-chain.js`: contiguity gate INSIDE the chain transaction (every repository version ≤ level
  recorded, nothing unknown); optional history repair rows in the same transaction; refused for `production`.
* `scripts/goldia-staging-release.js`: level detected in step 3 (no hard-coded FROM/TO); uses the shared chain
  (LF-normalized files, per-migration postflight + business fingerprint); with a repair the dry run STOPs unless the
  restored copy equals repository 001..level (missing objects 0, function bodies 0 different, CR-tolerant); every
  postflight 073..newest; emergency rollback newest-first + re-apply on the copy; `UP TO DATE` when nothing to do.
* `scripts/goldia-prod-release.js --auto [--expect-level NNN]`: read-only level probe, then the existing chain mode with
  exactly the detected range; production chain step 2 also checks the whole history (gap / unknown → STOP). No repair.
* `scripts/goldia-release.ps1`: no migration range and no skip switches any more; staging `-RepairStagingHistory`,
  production `-ExpectProductionLevel`; frontend deploy requires the newest migration of the commit.
* `07_prelaunch_081_readonly.sql` accepts 076..080; `production-prelaunch` at 076 runs 05 + 06 + 07 + parity 076 + baseline.
* `local-ui-076.js` UI-14 (stale since 077): now requires the manager to see exactly the director's preset and accounting
  actions (2 / ≥ 1), measured in the same run.

## 3. Evidence (local stand-in, 60 organizations, 200 users) — `evidence/release-rehearsal/auto-level/`
| Test | Result |
|---|---|
| staging 076 → 081 dry run: plan 077→078→079→080→081, chain + postflights 073–081, RLS read/write PASS, emergency rollback 081→077 + re-apply | **PASS** |
| staging 076 → 081 apply + postflight (history 81/81, gaps none, balances / counts unchanged) | **PASS** |
| re-run at 081 | **UP TO DATE**, nothing written |
| G1 staging shape (080, 057/058 unrecorded, CR bodies) without flag | **STOP** VERSION GAP 057, 058 |
| G2/G3/G4 partial / extra / invalid repair list | **STOP** |
| G5 recorded version unknown to the checkout | **STOP** |
| G6 058 column really missing + repair | **STOP** (missing 1) |
| G7 real code change in a function body + repair | **STOP** (different bodies 1) |
| G8/G9 exact repair 057,058 (CR bodies tolerated): dry run, apply → history 81, gaps none, postflights 073–081 | **PASS** |
| G10 re-run / G11 repair flag without a gap | UP TO DATE / **STOP** |
| G12 chain SQL run by hand on a gap | **ERROR** VERSION GAP, history unchanged |
| production `--auto --expect-level 076` (Windows simulation: CRLF files + CRLF psql): copy chain 077..081 + emergency rollback to 076 + re-apply, prelaunch 05/06/07 OK, parity 076, chain with 5 per-migration gates, postflights 073–081, fingerprint 76 categories unchanged, function parity 168 identical, RLS PASS | **PASS** |
| P1 auto at 081 / P2 wrong expected level / P3 auto + explicit range | UP TO DATE / **STOP** / **STOP** |
| P4 auto with 058 gap / P5 explicit 081 with gap (copy chain) / P6 repair on production | **STOP** / **STOP** (copy: VERSION GAP) / refused |
| production-prelaunch kit at 076 (05 + 06 + 07 + parity 076 + baseline) | **PASS** |
| 076 UI regression on 081 (local, real GoTrue + PostgREST + Next.js, Playwright) | **17/17** (UI-14 fixed) |
| vitest | **399/399** (6 new level-detection tests) |

## 4. Not done here / owner steps
* The real staging release (081 + history repair 057, 058) needs the owner's staging DB password:
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target staging -RepairStagingHistory 057,058`.
  Afterwards: the real-staging battery (081 advance, 077–080 regressions, 076 UI, reconciliation) — section 5 of the
  final report once run.
* Production level is unknown to this session (the conversation reported both 076 and 080); it is detected at release
  time by `--auto`, and `-ExpectProductionLevel` makes a mismatch a STOP.
