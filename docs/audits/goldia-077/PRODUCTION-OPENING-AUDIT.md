# Production opening audit (READ ONLY), 2026-11-17
Nothing was written anywhere. This session cannot reach production (frontend and database are blocked by the network:
`CONNECT tunnel failed, response 403`), so the LIVE DATA part is a read-only SQL file the owner runs; the CODE part is
confirmed from the repository at the deployed runtime (e55cd5d = df215f3 runtime trees; later commits only change tools).

## How to get the live numbers (owner, read only)
```powershell
cd $env:USERPROFILE\GoldiaRelease\production; git fetch origin claude/goldia-sales-077-parity-period-currency; git checkout --detach <this commit>
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production-opening-audit
```
Explicit BEGIN TRANSACTION READ ONLY + guard + ROLLBACK (the existing wrapper). History must be 085..087. Output file
`opening_audit.txt`: identity, period, every active A-J document, C / C2, factory, factory UI cards, B links, A usage,
duplicate receipts, stock rollup, per-seller recomputation, flags, RESULT. No customer name / phone / code (customer = first 8
characters of the id), no note of a customer document, J prints its type only.

| Section | What it proves |
|---|---|
| `AUDIT|doc` | document no, kind (letter), physical g, proba, 585 eq, factory / seller %, source document, linked receipt (no, physical, obligation, available, status), consignment (no, obligation, status), seller, created (Tashkent) |
| `AUDIT|C` | C (factory obligation without goods) and C2 (factory advance) exactly, plus the server helper `_goldia_opening_factory_net` |
| `AUDIT|factory` | independent = opening receipts obligation (with markup) + C - C2 + later receipts - later handovers, vs `manager_vault_account` (current obligation / advance / totals) |
| `AUDIT|factory_ui` | the two factory cards exactly as the page computes them, and the manager panel figure |
| `AUDIT|B_link` / `A_use` / `duplicate_receipt` | every B: its A source (kind, status, same period) or an OWN opening receipt (= an extra factory obligation); grams moved from each A; a receipt linked to two A documents |
| `AUDIT|stock` | manager available + seller held pieces + opening pieces sold since = opening receipts physical; A + B(own) documents = receipts |
| `AUDIT|seller` | B consignment obligation + E (his customers' 585 g debts) + F (currency snapshots) + D + later consignments / legacy - settled = recorded `seller_owes_manager_g` |

Local proof on a stand-in (A 100 g @8 %, B 30 g from A @12 %, B 10 g own @8/10 %, C 19.44, C2 5, D 3.4, E 6.6, F 200 USD @12 600/900 000):
independent factory 133.24 = vault 133.24; cards 118.80 / 118.80 (C and C2 ignored); stock 70 + 40 = 110 = receipts;
seller 44.6 + 6.6 + 2.8 + 3.4 = 57.4 = recorded; the own-receipt B flagged. RESULT REVIEW only because of that B.

## CONFIRMED CODE
| # | Finding | Where | Formula / effect |
|---|---|---|---|
| CC-1 | The "~2700 g shown twice": the factory page shows **Zavod Oldidagi Majburiyat** and **Hozirgi Sof Zavod Qarzi** from the same sum; with no handover since the opening both are equal | `src/components/sales/DirectorSalesWorkspace.tsx` 1444-1497 (`/sales/app/factory`) | card 1 = Σ `factory_receipts.factory_obligation_g` (status <> reversed); card 2 = max(0, card 1 - Σ `factory_gold_handovers.agreed_equivalent_g`) |
| CC-2 | Both cards (and the dashboard total) ignore the opening C and C2 documents, so they differ from the real factory account by C - C2 | same lines; `src/app/sales/app/page.tsx` 121-128 | real = vault `current_factory_obligation_g - current_factory_advance_g` = receipts + C - C2 - handovers (server, 085 `_goldia_vault_factory_add`) |
| CC-3 | Three different "factory" numbers on screens | manager panel `ManagerSimplePanel.tsx` 71 (vault, correct); factory page / dashboard (receipts only); `DirectorSalesWorkspace.tsx` 1143, 2098 and `SellerMobileWorkspace.tsx` 781 (Σ seller rows `current_factory_obligation_grams`, a per-seller legacy column, not the factory ledger) | the owner sees up to three values for one account |
| CC-4 | A B document without an A source creates its own opening receipt (own factory obligation and grams). Correct only if those grams are NOT also inside an A document | 085 `rpc_record_opening_document`, seller_inventory branch | double factory obligation / stock when the same goods were entered in A and in such a B |

## CONFIRMED LIVE DATA / NEEDS PHYSICAL RECOUNT
Pending the owner's run of `production-opening-audit` (this session has no production access; no number is invented).
Classification rule for its output:
* `AUDIT|factory` independent ≠ vault, `AUDIT|seller` diff ≠ 0, `duplicate_receipt`, `A_overdrawn_by_B` → **CONFIRMED LIVE DATA** (the stored balance or the documents are inconsistent; the document ids and formula are on the line).
* `B_link ... OWN opening receipt` → **NEEDS PHYSICAL RECOUNT**: confirm the goods are only on the seller (not also counted in A).
* `stock` rollup ≠ receipts, or a C / C2 / D amount without a written basis → **NEEDS PHYSICAL RECOUNT**.
* Old Google Sheets: no source is available in the repository or this session - not compared.

## Staging-only fix plan (no production change)
1. One factory figure everywhere: the vault net (receipts + C - C2 - handovers); the factory page shows its breakdown
   (opening receipts / C / C2 / later receipts / handovers) instead of two equal cards; remove the seller-row
   `current_factory_obligation_grams` sum from director / seller screens.
2. Opening page: show for every B whether it is "from A" or "own receipt (+factory obligation)" before saving; warn when an
   own-receipt B exists while A grams are still unassigned.
3. Tests: unit (card values = vault with C / C2 / handovers), the audit SQL on a stand-in, 390 px.
4. Staging release + staging smoke; production only after a separate approval.
