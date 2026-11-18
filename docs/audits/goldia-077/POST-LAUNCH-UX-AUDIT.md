# Goldia Sales post-launch UX & accounting audit (2026-11-18)
Base: commit edc9e84 (= staging frontend + DB 088; production frontend not readable from here - 403). Production
untouched. Branch: claude/goldia-p0-sellers-layout (P0 only).

## Status
| Item | Status | Summary |
|---|---|---|
| P0 sellers page layout | DONE (PR 1) | cards first; rates + operation-rate review in collapsible sections below; each card: obligation, stock, LOM, UZS, USD (always shown) and the receive button at the top; details collapsible |
| P1 CPAY vs SETTL clarity | PARTIAL (audit) | real gap found: CPAY is missing from the customer history RPC; UI plan below (separate PR) |
| P1 USD entered as UZS | PARTIAL (audit) | not a calculation bug: the SETTL dialog already has separate UZS / USD fields; UX fix planned (separate PR) |
| P1 return of an old (pre-T0) sale | BLOCKED (design only, needs decisions) | business rules + test scenarios below; no migration |
| P2 seller's personal use of customer money | DONE (analysis) | already tracked by the seller till; no new account type needed |
| P2 stock movement audit | PARTIAL (design) | read-only report design below |

## P0 - what changed (layout only, no DB / RPC change)
* `src/app/sales/app/sellers/page.tsx`: DirectorSalesWorkspace (seller cards) first; `SellerRatesOverview` and
  `OperationRateReview` (an informational list, no pending action) moved into `<details>` sections below.
* `src/components/sales/DirectorSalesWorkspace.tsx` (sellers tab card): header with the receive button; a compact metrics
  row (Majburiyat with sign colour, Ombor = current_physical_stock_g, LOM, UZS, USD); the former big "Bozor qarzi" block and
  the received / obligation / handed-over breakdown kept inside "Batafsil"; the duplicate till grid and the duplicate
  receive button removed. The workspace's global audit / profit / rate-difference banner was already hidden on this page.
* `src/lib/seller-card-metrics.ts` (+ test): the card numbers, read exactly as stored, same sign rule as before.
* Checks: unit tests 7/7 (new + factory summary), tsc, eslint (changed files), next build PASS.
  Not done here: a real 390 px screenshot (needs a running stack with data) - to do on staging with a synthetic org.

## P1 - CPAY and SETTL (findings)
* SETTL (`rpc_record_client_settlement`, SellerMobileWorkspace / CustomerLedgerAndSheetsSection): pays the customer's
  585 GRAM debt; cash UZS and USD are converted to grams at the payment's rates.
* CPAY (`rpc_record_client_currency_settlement`, CurrencyPaymentModal): pays a UZS / USD CURRENCY debt in that currency.
* Both are separate documents; nothing prevents recording one real payment in both (that is the reported 500 USD case).
* CPAY is in the period report (`_goldia_period_effects`), in the modal's own history (with reverse), but NOT in the
  unified customer history (`rpc_get_unified_customer_ledger` has no client_currency_settlements) - confirmed gap.
Plan (UI first, separate PR): a header in each dialog naming the debt it closes ("585 gramm qarzi" / "UZS qarzi" /
"USD qarzi") with the customer's current balances of all three; a duplicate warning when the same customer received a
payment of the same amount (any type) in the last 30 minutes; the history line with number, type, currency, rates,
status and reverse. Adding CPAY to the unified customer history needs a read RPC change (separate approval).
Reversal correctness (customer debt, till, obligation) is already covered by the 088 suites (U2, M2, M3).

## P1 - USD entered as UZS
The SETTL dialog has "Naqd UZS" and "Naqd USD" fields and asks for a USD rate. Plan: label the fields "Mijoz bergan
SO'M" / "Mijoz bergan DOLLAR (kursga ko'paytirmang)", show a live line "X USD x kurs = Y so'm -> Z g" only in the USD
block, and warn when a UZS amount equals a whole number of dollars at the saved USD rate. Tests: USD into a USD debt
(CPAY), USD into a UZS debt (CPAY, USD rate), USD into a gram debt (SETTL, USD + 585 rate). Existing payments are never
recalculated.

## P1 - return from an old (pre-T0) sale: decisions needed (no code)
The customer's debt exists only as an opening E (585 g) or F (UZS / USD) document; no sale document to reverse.
Proposed document "Eski savdodan vozvrat" (own kind, audited, reversible, never edits locked opening documents):
inputs customer, seller, returned physical grams, the original customer %, the receiver (seller or manager), reason.
Questions for the director:
1. Value credited to the customer: grams x (1 + original customer %)? (E debt in 585 g; for F debts: at which rate?)
2. Goods back to the SELLER: stock + grams; the seller's obligation for them: grams x (1 + which seller %)? The customer
   debt part of the seller obligation goes down by the credited value - net seller change = new goods obligation - credit.
3. Goods back to the MANAGER: manager stock + grams; no factory obligation (settled before T0) - confirm.
4. Credit larger than the debt: advance for the customer or refused?
Test scenarios to write before any migration: full / partial return to seller and to manager, credit = / < / > debt,
reversal restores everything, a return on a customer with only an F (currency) debt, a second return on the same debt.

## P2 - seller's personal use of customer money (read-only analysis)
When the seller records the customer's 5 000 000 UZS, the customer's debt closes and the seller's TILL rises by 5 000 000
(and for a currency/opening debt the valued pool by its grams). The till is the seller's liability to hand over: the
seller card shows it (UZS cell) until a handover. If the seller spent it, the till still shows it - the obligation is
already tracked, nothing is lost and nothing should be added (a new debt would count it twice). When the seller brings
it back, the normal handover moves it to the manager once. Optional (separate approval): a note / flag on the till
("shaxsiy ishlatilgan, qaytariladi") for visibility only.

## P2 - stock movement audit (design)
Read-only SQL + page per seller and date range: opening B goods + consignments received + customer returns to the seller
- sales - returns to the manager = current_physical_stock_g, each line with its document number; flags: a consignment
or return recorded twice (same pieces / same amount within minutes), a difference to the stored stock. No balance is
changed.

## Release recommendation
PR 1 (P0) only: UI, no DB. Staging first (synthetic org, 390 px check), then production with the director's approval.
