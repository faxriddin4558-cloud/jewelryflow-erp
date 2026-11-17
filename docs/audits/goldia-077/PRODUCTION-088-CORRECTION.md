# 088: factory account per the real business rule + optional rates for UZS / USD opening debts (2026-11-17)
Status: built and tested locally; NOT released. Production (087, real draft opening, freeze active) was not touched -
this session cannot reach it (network 403).

## Business rules implemented
1. Seller goods at T0 (1 711.09 g) were settled with the factory before T0 by the manager. New opening document
   `factory_settled` (one per seller-inventory B document, server-computed, cancellable, audited):
   * B with its own opening receipt -> that receipt's factory obligation (grams x (1 + its factory %));
   * B taken from an A document -> B grams x (1 + that A's factory %).
   It lowers the factory account only. Seller stock, seller obligation, customer debts, A / C / C2 and every receipt stay
   as they are. Future factory receipts follow the normal rule.
   Final factory net = Σ over the manager's A goods (grams x (1 + each A's own %)) + C - C2 - later handovers.
   Negative: the factory owes the manager. Positive: the manager owes the factory.
2. UZS / USD opening customer debt (F): amount + currency required; the 585 and USD rates optional (USD: both or none).
   Without them: kept in its currency, never valued with 0 / 1 / today's rate, no seller grams, shown as
   "Hali hisoblanmagan" and as a separate total. Each payment values only the part that pays THAT opening debt
   (capped at what is left of it) at that payment's rates; that part enters the seller's 585 obligation and the valued
   till pool (the handover closes it); a reversal takes it out; a part paying an ordinary sale debt stays unvalued
   (converted at the handover); once the opening debt is paid off, later payments are ordinary. Rated debts: unchanged.

## Production numbers (owner's screenshot) - OLD / NEW
| Item | OLD | NEW | How |
|---|---|---|---|
| Factory net | +694.072 g (manager owes factory) | Σ_A 498.21 g x (1 + each A %) - 1 717.58 | exact grams from `production-opening-audit` `AUDIT|projection_088` (two independent formulas must agree) |
| Seller goods in the factory account | 1 711.09 g with markup | 0 (factory_settled) | `AUDIT|projection_088_B` per B document |
| C2 | 1 717.58 g | 1 717.58 g | unchanged |
| Manager stock | 498.21 g | 498.21 g | unchanged |
| Sanatbek / Omonboy stock | 926.92 / 784.17 g | same | unchanged |
| Sanatbek / Omonboy obligation | 2 821.6017 / 1 710.6707 g | same | unchanged (factory_settled never touches sellers) |
| Manager LOM / UZS / USD | 1 157.90 g / 315 319 000 / 3 700 | same | unchanged |
| Customers 585 debt / advance | 2 399.82 / 6.82 g | same | unchanged |
| Customers UZS / USD debt | 52 190 000 / 2 986 | same | existing rated documents are not revalued; new unrated ones are shown separately |
Illustration only (not production data): with A = 300 g @8 % + 198.21 g @10 %, the new net = 542.031 - 1 717.58 = -1 175.549 g.

## Tests (local)
* vitest: see the final run; 088 suite 7/7 (factory before/after, per-B amounts, duplicates, B from A, cancel, unrated UZS / USD,
  partial payments at different rates, reversal, handover, overpayment, opening + sale debt of one customer, paid-off debt).
* real PostgreSQL 17: 088 postflight true; rollback = exact 087 signature; re-apply = exact 088; production-shaped prod-kit
  rehearsal 087 -> 088 (draft opening + active freeze + 58 CRLF) ALL GATES PASS, business fingerprint unchanged.
* two independent reviews: one MAJOR found and fixed (unrated payment not capped), the rest listed below.

## Open decisions (not changed)
1. 085 rule: a customer with a RATED opening debt who pays an ordinary currency sale debt: the whole payment enters the valued
   pool, so the seller gets no handover credit for the sale part (overcharge = that part). Fix = pool only the opening
   part, like 088 does for unrated debts. Changes 085 behaviour -> needs the director's decision.
2. 085: reversal of a payment after a partial handover can lose averaged pool grams (probe: 0.2084 g).
3. 085: a payment taken into another seller's till is not matched to the customer's opening document.
4. Baseline / profit value all customer UZS / USD receivables (unrated included) at the baseline rate (084 rule).

## Names (applied = proposed by the director; others wait)
Applied: Zavoddan olingan tovar, Tovar bo'yicha qarz, Oldindan berilgan oltin, Zavodning menejerga qarzi,
Menejerning zavodga qarzi. The duplicate factory card was removed.
Waiting for approval: Menejer Omboridagi Mavjud Tovar -> Menejer qo'lidagi tovar; 585 eq -> 585 hisobida; fizik -> haqiqiy vazn;
Zavod ustamasi -> Zavod qo'shimchasi; Sotuvchi majburiyati ustamasi -> Sotuvchi qo'shimchasi; C -> Zavodga tovarsiz qarz;
C2 -> Zavodga oldindan berilgan oltin; D -> Sotuvchining boshqa qarzi; Mijoz avansi -> Mijozning oldindan to'lovi;
585 kursi -> 1 g 585 oltin narxi; LOM -> Lom (eski oltin); T0 -> Hisob boshlanish vaqti; Solishtirish -> Tekshiruv.
