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

### d. Seller cancels own sale
The existing `rpc_reverse_client_sale` does the atomic work: customer debt, pieces, stock, seller account, row locks, mandatory reason, document kept as `reversed`.

A new trigger applies only when the caller is a seller. It refuses a sale that:
- belongs to another seller;
- was recorded by someone else (new `jewelry_sales.recorded_by` column; old rows stay null);
- has a later payment (SETTL or CPAY);
- falls in a closed report period.

Sales with a vozvrat were already refused by 083.

The manager / director flow is unchanged.

### e. UI
- **Factory page:** "Menejer omboridan zavodga tovar qaytarish" — the server computes the values, a history list, reversal with a reason.
- **Customer journal:** the "Bekor qilish" button shows for a seller on his own sales. Server errors are shown in the reason modal.

## 2. Tests
| Check | Result |
|---|---|
| vitest (all) | 60 files / 506 tests PASS |
| 090 suite | 9/9 PASS |
| tsc | PASS |
| eslint | no new problems (24 old harness-file problems, the same without 090) |
| next build | PASS |
| PG17 empty 001 → 090 | applies; postflights 073–090 all true; parity 200/200 identical |
| PG17 rollback | 090 → emergency rollback → signature equals 089 exactly; re-apply equals 090; second apply makes no change |
| Production-like local 088 (seeded: opening, LOM, CPAY, receipt, consignments, sale) | auto release 088 → 089 → 090: full backup, restore, business fingerprint, chain, emergency rollback to 088, re-apply, postflights, RLS isolation, parity — ALL PASS. A login-log writer ran during the dump; it was not deciding |
| Staging E2E (`e2e_090_staging_rolledback.sql`) | 17/17 PASS locally (on 089 + 090 in one transaction, and on 090) |

The E2E runs on real staging only after the staging release.

## 3. Found, not changed (needs the owner's decision)
`rpc_record_factory_gold_handover` (073) recomputes `total_factory_handed_over_g = Σ factory_gold_handovers`. This drops the opening C2 factory advance that `_goldia_vault_factory_add` had added.

Local proof: net 58 → 103 instead of 53 after a 5 g scrap handover.

It affects production if a scrap-gold handover is recorded after the opening (C2 = 1 717.58 g). This is outside the 090 scope; the fix would make the handover update delta-based.
