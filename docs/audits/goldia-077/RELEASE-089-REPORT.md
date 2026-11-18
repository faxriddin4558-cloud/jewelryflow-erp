# Goldia Sales 089 — remaining post-launch functions in one release (2026-11-18)

Branch `claude/goldia-089-remaining-features`. **Production untouched (strict read-only), nothing deployed.**
DB 088 → 089 (one migration), frontend with the five functions. Opening documents (LOCK), 088 rules, factory accounts and
every existing row are unchanged.

## 1. What 089 adds
| # | Function | Server | UI |
|---|---|---|---|
| 1 | Old-sale return (goods sold before T0) | `opening_sale_returns`, `rpc_preview_opening_sale_return` (STABLE), `rpc_record_opening_sale_return`, `rpc_reverse_opening_sale_return` | "↩️ Eski savdo vozvrati" on each customer (desktop + phone), management only; server preview + "tekshirdim" checkbox before saving; reversal from the journal |
| 2 | CPAY in the customer history | `rpc_get_daily_sales_ledger`: `currency_payment` and `opening_return` rows (0 g in every gram column); `rpc_get_unified_customer_ledger`: per-customer `currency` (UZS / USD debt, advance, CPAY paid / count / reversed) and `old_sale_return_g` | own badges "💵 CPAY (so'm / dollar qarz)" vs "💰 To'lov (585 g)"; CPAY reversal routed to its own function |
| 3 | Wrong-currency payment correction | `rpc_correct_client_payment`: existing reversal + existing record function in ONE transaction | "💱 Valyutani tuzatish" on SETTL / CPAY rows (management); whole-dollar so'm amounts are moved to the dollar field for review |
| 4 | Seller personal money | `seller_till_counts`, `rpc_record_seller_till_count` (record only) | "🧮 Kassa sanog'i" on the seller card: counted vs till, difference, reason (shaxsiy ishlatilgan / yetishmovchilik), last 5 counts |
| 5 | Stock movements | `rpc_get_seller_stock_movements` (STABLE) | `/sales/app/stock-movements` (menu "Ombor harakati", seller card link): seller + date filter, opening / in / out / closing, stored stock, held pieces, possible duplicates |

## 2. Business rules (no guessing; decisions follow existing logic)
Old-sale return — there is no sale document, so **no sale is created**; the document points at the customer's locked
opening debt (E = 585 g, F = UZS / USD). Without such a debt the return is refused (`ERR_NO_OPENING_DEBT`).
* Value: 585 → grams × (1 + the ORIGINAL customer %), the % is required (`ERR_PCT_REQUIRED`); UZS / USD → the original
  amount of the returned goods, required (`ERR_AMOUNT_REQUIRED`) — never derived from a rate (083 rule: value of the
  original sale, not re-priced).
* Split (083 decision): debt part = min(value, open debt), the rest becomes an advance; no cash refund.
* Seller (076 rule: lowering a debt lowers the seller's obligation → management only): only the part that pays the
  OPENING debt releases the seller's opening obligation — E: its grams; rated F: its share of the document's rate
  snapshot (the whole remainder when it pays the debt off); unrated F: 0 (it was never in the obligation). A later CPAY
  takes only what is left of the opening debt — counted once.
* Seller obligation (corrected 2026-11-18, owner's rule): the OLD obligation of the returned goods is taken from the
  documents - E: what the E document's legacy row put into this seller's obligation, pro rata of the paid opening part;
  rated F: its share of the rate snapshot; unrated F: 0. No seller % is entered (`ERR_SELLER_PCT_NOT_USED`).
  - kept by the SELLER: that old obligation moves unchanged from the opening debt onto the return lot
    (`seller_lot_obligation_g`) - the seller's total obligation does NOT change (5 g at 20 %: customer -6 g, seller 0;
    never "-6 + 5.60"); a later sale / return to the manager uses exactly those grams. Refused when part of the value has
    no documented obligation (advance part, unrated debt): `ERR_SELLER_KEEP_NOT_DOCUMENTED` -> receive at the manager.
  - to the MANAGER: the old obligation leaves the seller, manager stock + grams (existing `rpc_return_piece_to_manager`).
  Never a factory receipt or factory obligation (pre-T0 goods were settled before T0, 088).
* Mandatory idempotency key, reason, `p_confirmed = true` after the preview; audit rows; reversible while the returned
  piece is untouched (`ERR_RETURN_GOODS_USED` otherwise). A draft opening or an active freeze refuses it (the lot rows are
  in the guarded consignment tables; the guard itself stays on its 12 tables, as 086 / the UI-release lock expect).

Payment correction — the old payment is reversed by its own function (all checks kept, e.g. 088 pool order, freeze)
and the new one recorded by the existing SETTL / CPAY function, same customer and seller; if any step fails nothing is
written. Till counts — the till already is the seller's obligation, so a count creates no debt and changes no balance.
Stock movements — read only; differences and duplicates are shown, never corrected.

## 3. Evidence (local, production-shaped; nothing against staging / production from here)
| Check | Result |
|---|---|
| New suite `goldia-089-remaining-features` (PGlite, real `authenticated` role + RLS): refusals (no %, no amount, no confirm, seller, no opening debt, active freeze); E to seller (−12 g customer, obligation −1 g, stock +10, replay = same doc, ledger recompute keeps 38 g, opening doc unchanged); E to manager with advance (6.6 = 5 + 1.6, released 5, manager +5.5); rated F (5 g of 10 g released, next CPAY takes exactly the other 5 g); unrated F (0 released, next CPAY values only the rest); reversals (customer, obligation, stock, manager stock restored; double reversal and used goods refused); journal CPAY / old-return rows; correction USD-typed-as-UZS → USD (atomic failure leaves the old payment, till −6 325 000 so'm / +500 USD, one audit row); till count (record only, reason required, seller refused, RLS); stock movements (all-time = stored stock for every seller, seller sees only himself); period effects (stock column = stored stock, old-return 585 effect = documents); rollback refused with 089 rows; owner's example 5 g @ 20 % kept by the seller (customer -6 g, seller unchanged, later to the manager exactly -6 g); seller keep refused without a documented obligation | **14/14** |
| UI helpers `goldia-089-ui` | 3/3 |
| Full vitest regression (083 returns, 084 rates, 085 opening, 086 freeze, 088 money model, role access, …) | **497/497** |
| `scripts/lib` tests | 6/6 |
| `tsc --noEmit`, eslint (changed files), `next build` (new route `/sales/app/stock-movements`) | PASS |
| Native PostgreSQL 17, migrations 001–089 from LF files: postflights 073–089 | all columns true |
| Rollback 089 → functions + columns identical to a fresh 088; re-apply 089 | PASS |
| Emergency rollback 089 (with history) → schema signature = expected-088 | PASS |
| Signature 089 vs 088 | exactly the 5 changed function bodies differ; everything else additions |

Fixed on the way: `sales-payment-rates` test still looked for the cash label renamed in the P1 UI (3d87193) — test
updated; the 073 postflight / test count the new business-date default (`opening_sale_returns.return_date`).

## 4. Release kit
`supabase/migrations/20260101000089_…` (generated by `docs/releases/production-075/gen/gen-089.py` from the current 088
bodies with asserted replacements), `supabase/rollback/20260101000089_rollback.sql` (refused while 089 rows exist),
`supabase/release/089_postflight_readonly.sql`, `function_body_parity_089_full_readonly.sql`,
`staging-073/expected-089-signature.txt`, `emergency/rollback_089_with_history.sql`; `goldia-release-checks.js` (089 gate +
088 / 086 / 085 / 083 still true), `run-readonly-checks.ps1` (089 accepted by prelaunch / post / opening-audit, loops),
read-only smoke (two STABLE RPCs allowed, `/sales/app/stock-movements` visited). Not run here: the PowerShell scripts
(no PowerShell in this container) — the first run is the owner's staging release.

## 5. One staging test, one production release
**Staging (owner, Windows):**
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target staging -Branch claude/goldia-089-remaining-features
```
(DB 088 → 089 with backup / chain / postflight gates, frontend, smoke.) Then on staging with a test customer: one E
return to the seller and one to the manager (preview → confirm → save → reverse), one F return then a CPAY, one wrong-
currency CPAY correction, one till count, the stock-movements page (all sellers "✓ mos"), the journal badges, 390 px.

**Production (only after staging PASS and the director's separate written approval):** the full release (NOT
`-UiOnly`, this is a database change):
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target production -Branch claude/goldia-089-remaining-features -ApprovedCommit <sha> [-TestedCommit <staging sha>]
```
Prelaunch at 088 (full set) → backup + chain 088 → 089 + postflight → frontend → production-post → read-only smoke
(live balance snapshots). Rollback path: `rollback_089_with_history.sql` while no 089 document exists.
