# Goldia 090 — final package on top of 089 (production 088 → 089 → 090 in one release)

Production is untouched (read-only rule). Staging has not been changed from here.

## 1. Changes (migration `20260101000090_goldia_consignment_cancel_factory_return_seller_cancel.sql`)

### a. The five 089 functions
- Their bodies are unchanged, except for the two report functions listed in (b).
- The 089 postflight stays all true on 090.

### b. Consignment cancellation (the 39.46 g case)
Proven bugs in the existing `rpc_reverse_barcode_consignment` (039):
1. It put all grams back on the ONE receipt stored on the consignment. A FIFO consignment that took 16 g from opening A and 23.46 g from a later receipt was put back entirely on A, above what A had given out.
2. It computed the weight as `base − returned`, which subtracts returns twice.
3. The period report and the 089 stock movements took the grams off the seller TWICE: once as `consignment_cancelled` and again as `return_to_manager` (same timestamp). Stored balances were right; only the reports were wrong.
4. It did not recalculate the seller account.
5. An opening B consignment could be cancelled (this breaks the LOCK).

Fixes:
- **Allocations at issue.** The issue now records the grams taken from each receipt in `consignment_receipt_allocations`.
- **Exact restore.** A cancel or a piece return puts the grams back on exactly those receipts, never above what each receipt gave.
- **Pre-090 consignments.** These have no allocation record:
  - single-receipt: restored within what the receipt really gave out;
  - multi-receipt: refused (`ERR_CONSIGNMENT_RECEIPT_UNKNOWN`) and nothing is guessed.
- **New refusals:** opening B (`ERR_OPENING_CONSIGNMENT`), 089 return lots, consignments with sold pieces.
- **Double cancel** is refused.
- **Reports.** The double count is removed from the period report and from stock movements.
- **Production data.** No data correction: `supabase/release/consignment_cancel_audit_readonly.sql` shows the real case read-only.

### c. Manager → factory goods return
- No safe existing operation:
  - `rpc_record_factory_gold_handover` is for scrap gold;
  - `rpc_reverse_factory_receipt` only works on a whole, untouched receipt.
- New RPC `rpc_return_goods_to_factory(receipt, grams, reason, key)`:
  - management only; partial or full return;
  - value = grams × (1 + %/100), where % is the receipt's own rate (opening A uses the A document's %);
  - receipt available − grams; manager stock − grams;
  - booked as a `factory_gold_handovers` row with source `finished_goods_return`. The factory net goes down by the value; with an advance, the advance grows. The period report shows it once.
- Refused:
  - more than in stock;
  - goods without a factory receipt (no rule approved);
  - grams already settled to the factory through B (`ERR_SETTLED_GOODS`);
  - sellers.
- No effect on seller obligation, customer debt or profit.
- Idempotent.
- Reversal `rpc_reverse_factory_goods_return` restores everything. The generic handover reversal is refused for these rows.

### d. Sale edit (replaces "seller cancels own sale"; no new cancel right)
Existing mechanism checked first: `rpc_reverse_client_sale` (atomic storno: customer debt / advance, pieces or weight
allocations, seller account, currency debt, row locks, reason) + the three sale functions (weight / piece / UZS-USD).
A field-by-field UPDATE of a sale would have to re-implement all of that (big, risky). The minimal safe edit is
`rpc_edit_client_sale(sale, reason, key, grams?, %?, piece?, pieces?, price?)`:
original reversed + corrected sale recorded with the same customer and seller, in ONE transaction, from those existing
functions only (any failure, e.g. not enough stock, rolls everything back). The original stays as `reversed`, the
corrected sale is a new document dated today; `sale_edits` (+ `audit_logs` EDIT_CLIENT_SALE) keep who / when / why /
old / new values. Weight sale: grams, %, (pieces; default = the same pieces again); piece sale: another piece, %;
UZS / USD sale: price, grams.
Refused for a seller: another seller's sale, a sale recorded by someone else, a payment after the sale, a customer
return, a closed report period. For everyone: return, closed period, before T0, a sale whose pieces moved, no change,
no reason. Idempotent; parallel edits of one sale serialize on the row lock (the second one is refused). Manager and
director: any sale of the organization (same rights).
The seller-side guard on reversals (own + self-recorded + no later payment + open period) is kept: it RESTRICTS the
existing seller reversal of piece sales; the UI cancel button condition is back to the original one (no new right).

### d2. Factory page cards (UI only; formulas, balances, LOCK unchanged)
Source: `src/lib/factory-account-summary.ts` (data: factory_receipts, factory_gold_handovers, opening_documents, manager_vault_account; same queries and RLS for director and manager).
| Card | Formula | Kind |
|---|---|---|
| Zavoddan olingan tovar | sum original_physical_g of active receipts | cumulative since T0 |
| Menejer omboridagi tovar | sum available_physical_g | current stock |
| Zavod tovari uchun majburiyat (jami) | sum receipt g x (1 + %) - B factory_settled; now split: opening A / receipts after T0 | cumulative since T0 |
| Zavodga berilgan oltin (jami) | C2 factory_advance (T0 document, locked) + active handovers (all after T0: the 085 restart reversed every earlier one) + goods sent back; now split | cumulative since T0 |
| Joriy qoldiq | vault obligation - advance; now with "= goods + C - given" line | CURRENT balance: + receipt, - handover / goods return |
1717.58 g = production C2 (opening factory_advance, a T0 document, does not change). 2248.18 g and 575.38 g are
production values only the read-only `supabase/release/factory_cards_readonly.sql` can tie to a card (expected:
2248.18 = "berilgan oltin" = C2 1717.58 + 530.60 handed after T0; 575.38 = one of the current-balance values) - not
assumed here. Labels, tooltips and split lines added; nothing recomputed.

### e. UI
- **Factory page:** "Menejer omboridan zavodga tovar qaytarish" — the server computes the values, a history list, reversal with a reason.
- **Customer journal:** "✏️ Tahrirlash" on sale rows (management: every sale; seller: his own); server errors shown in the dialog. "Bekor qilish" unchanged.
- **Factory page cards:** clearer names, tooltips, T0 split lines.

## 2. Tests
| Check | Result |
|---|---|
| vitest (all) | 61 files / 513 tests PASS (090 suites: consignment / factory 9/9, sale edit 6/6, factory cards split 1) |
| tsc, next build | PASS |
| eslint | no new problems (24 old harness-file problems, the same without 090) |
| PG17 empty 001 -> 090 | applies; postflights 073-090 all true (090: 20 columns); parity 201/201 identical |
| PG17 rollback | 090 -> emergency rollback -> signature equals 089 exactly; re-apply equals 090; second apply makes no change; rollback refused while goods returns / sale edits exist |
| PG17 parallel edit | two edits of one sale at once: one wins, the other ERR_SALE_ALREADY_REVERSED; the same key twice in parallel: one edit, same answer; customer debt exact (3.6 -> 4.2 -> 4.8) |
| Production-like local 088 (seeded) | auto release 088 -> 089 -> 090: full backup, restore, business fingerprint, chain, emergency rollback to 088, re-apply, postflights, RLS isolation, parity - ALL PASS (a login-log writer ran, not deciding) |
| Staging E2E (`e2e_090_staging_rolledback.sql`) | 19/19 PASS locally (089 + 090 in one transaction, and on 090); runs on real staging after the staging release |

## 3. Found, not changed (needs the owner's decision)
`rpc_record_factory_gold_handover` (073) sets `total_factory_handed_over_g = sum of handover rows`; this drops the opening
C2 factory advance. Local proof (cards SQL on a copy): C2 100 g + one 5 g scrap handover -> stored handed-over total
5 g instead of 105 g; current-balance card 181.6 g instead of 81.6 g; the page shows "Kartalar ... mos emas: 100 g".
In production (C2 = 1717.58 g) the same happens on the first scrap / refined gold handover after T0.
`supabase/release/factory_cards_readonly.sql` shows it (column `kartalar_farqi_g` = -1717.58 when affected).
The fix (handover booked as a delta, plus a document-based repair of the stored total) changes balances, so it is not
in 090 without the owner's approval.
`scripts/verify-prod-final-ui.js` (old standalone UI check, not in the release flow) still looks for the old card text
"Zavodga Qaytarilgan Oltin".
