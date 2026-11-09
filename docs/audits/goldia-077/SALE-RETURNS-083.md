# Goldia Sales — partial / full customer returns ("↩️ Vozvrat"), migration 083

Date 2026-11-09. **Production FREEZE: nothing deployed or migrated.** Staging still at 081 (083 needs the owner's
staging release). Everything below is proven on the local production-shaped stand-in (PostgreSQL 17 + GoTrue +
PostgREST + the real Next.js frontend, Playwright), through the same gated release script that staging uses.

## 1. Business rules — ambiguities resolved by the owner (2026-11-09)
| Question | Decision |
|---|---|
| Customer already paid (return value > open debt) | the excess becomes a **585 g / currency advance**; no cash refund now (separate later decision) |
| Barcode (one piece) sale | **whole piece only**; partial grams only for weight (FIFO) and UZS / USD sales |
| Who may return | **like a sale reversal**: seller only his own sale, manager / director any sale; "received by the manager" only by manager / director |
Rules derived without guessing (they follow the existing model): value = share of the ORIGINAL sale (grams × original
markup, or the original UZS / USD amount; never re-priced at today's rate); the return that completes the sale takes the
exact remainder (no rounding drift); goods come back as a held piece on the seller's shelf (stock = held pieces stays
true); a manager reception uses the existing `rpc_return_piece_to_manager` (consignment weight and seller obligation
down by w × (1 + seller markup of the piece's consignment), manager stock up) — gold is counted once.

## 2. Architecture (minimal, no change to existing rows)
* New table `jewelry_sale_returns` (one document per return; RLS; no direct writes; value-split constraint
  `debt_reduced + advance_created = returned value`). The original sale row is **never** updated.
* New RPC `rpc_record_sale_return(p_sale_id, p_weight_grams, p_reason, p_destination, p_idempotency_key)`: mandatory
  idempotency key, sale row `FOR UPDATE` (serializes parallel requests), account `FOR UPDATE`, over-return refused,
  audit log row.
* Guard trigger: a sale with confirmed returns cannot be reversed as a whole (`ERR_SALE_HAS_RETURNS`) — otherwise the
  full reversal would restore the already returned grams a second time.
* Aggregates that sum sales subtract confirmed returns: seller stock (`recalc_seller_gold_account`,
  `get_seller_available_stock_grams`), unified ledger, monthly report (`returns_in_month_g`), daily ledger (return rows),
  period report effects (`return_gram / _uzs / _usd`) and its CSV, markup-difference report, seller reconciliation
  statement, three-tier summary; the test reset marks returns reversed first. Profit summary needs no change (it reads
  balances). Why not a negative sale row: `jewelry_sales` CHECK constraints (weight / due / quantity > 0) protect every
  sale and would have had to be weakened.
* UI: "↩️ Vozvrat" on every sale row of "Mijozlar va Nasiya" → daily ledger; dialog shows the original sale, already
  returned and returnable grams, the value preview, receiver (manager / director only), reason; one key per dialog,
  busy lock. Return rows show as "↩️ Vozvrat" documents (no reversal button). Period report labels.
* Rollback 083: refused while any return document exists; otherwise restores every previous body (schema identical to
  082 — proven).

## 3. Evidence (`evidence/local-083/`)
| Test | Result |
|---|---|
| ret-083 (local, real Auth): 100 g @12 % → 20 g back = −22.4 g, sale stays 100 g / 112 g, stock +20 = held pieces; 20 + 30 + 50 g = 22.4 + 33.6 + 56.0 = 112 exactly; over-return / fully returned refused; paid → advance 5.5; partly paid → 5 + 1.6; applied advance → 8 + 3; USD 100 / 3 → 33.33 + 33.33 + 33.34; UZS 1 000 001 / 3 → exact; barcode partial refused, whole piece back; manager reception: seller stock 0, manager +4, obligation −4.48 (12 % source consignment); 8 security refusals; idempotent replay + parallel; reversal blocked after returns; stock = held pieces; unified ledger, monthly report, period report, daily ledger, markup report = live; seller UI desktop + 390 px with double click → one document each | **28/28** |
| staging release rehearsal 081 → 082 → 083 (backup, restore, chain with per-migration postflight + fingerprint, postflights 073–083, RLS read / write, emergency rollback 083 → 082 → 081, re-apply, apply + postflight) | **PASS** |
| test reset with 56 confirmed returns | PASS (returns reversed, sales reversed, accounts 0) |
| regression on 083: balance-082 19/19, adv-081 11/11, ui-076 17/17, ui-077 21/21, ui-078 10/10, da-079 14/14, parity matrix 0, currency 13/13, stress-076 16/16 | **PASS** |
| vitest | **413/413** (8 new 083 guards) |
Two release-kit checks were made 083-aware after the rehearsal stopped on them (the gates worked): the 082 postflight's
closing-balance line match and the 073 business-date default column count (+1 `return_date`), also in its unit test.
Local-only: the disposable restore cluster now starts with `jit=off` (this sandbox's PostgreSQL lacks LLVM).

## 4. Not done / limits
* Real staging: needs `goldia-release.ps1 -Target staging` (081 → 082 → 083 + frontend), then the staging battery.
* No cash refund (decision); no undo of a return document (a wrong return is corrected by a new sale); returns are dated
  on the business day they are recorded (a closed report period is not reopened by a return).

## 5. Verdict
**Production: NO-GO** (freeze; staging verification and owner approval pending). Staging: ready for the owner's release.
