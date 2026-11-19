# Goldia 091 — C2 handover fix + seller LOM purchase (on top of 090; production 088 → 089 → 090 → 091 in one release)

Production untouched (read-only). 090 (commit 7dcc6bd) kept unchanged; 091 is a new migration.

## 1. C2 fix (`rpc_record_factory_gold_handover`, `rpc_reverse_factory_gold_handover`)
- Defect: the handover set `total_factory_handed_over_g = sum of handover rows`, dropping the opening C2 advance
  (and C / 090 goods returns) from the factory account on the first gold handover after T0.
- Fix: a handover and its reversal move the account by exactly their 585 equivalent through `_goldia_vault_factory_add`
  (the helper C, C2 and goods returns already use; refuses a negative total). No silent clamp at 0 on reversal.
- No balance correction: an account the old code already got wrong stays as it is.
  `supabase/release/factory_cards_readonly.sql`: column `kartalar_farqi_g` per organization (0 = correct;
  -C2 = defect hit). Proven on a copy: the 088 code gave -50.00 for C2 50; after the 091 release still -50.00
  (nothing guessed), new handovers exact.
- Checked: C2 + receipts + C, scrap handover on the advance side (-23.4 → -28.4) and on the obligation side
  (86.6 → 81.6), reversal exact, 090 goods return / its reversal, cards = account, period report factory column = account.

## 2. Seller buys LOM at the bazaar (`seller_lom_purchases`, `rpc_record_seller_lom_purchase`, `rpc_reverse_seller_lom_purchase`)
- Existing mechanisms checked: `gold_purchases` = the manager's purchase (manager vault), `financial_transactions` =
  capital / expense - neither is an exchange inside the seller's till. The new document changes only the EXISTING till
  columns of `seller_gold_accounts` (no parallel account).
- Purchase: UZS till - amount; LOM till + physical g and + 585 eq (physical x proba / 585, the LOM payment formula;
  proba 300-1000); the spent UZS takes its share of the valued cash pool (072), so later cash / LOM handovers close
  exactly what each carries. Customer debt, seller obligation, factory account, profit: untouched.
- Fields: date (today or earlier, open period, not before T0), physical g, proba, total UZS or price per g (both: must
  match), counterparty, note. Immutable audit row (who, when, UZS, g, proba, price, pool share).
- Refused: more UZS than in the till, another seller's till, bad proba / price, future date, opening draft, backup /
  restart freeze. Idempotent; the account row lock serializes parallel purchases.
- Reversal: only while the bought LOM is still in the till (else `ERR_LOM_ALREADY_USED`); UZS and pool share back.
- Later the existing seller → manager handover takes the LOM; the obligation goes down by its 585 equivalent.
- Period report: own kind `seller_lom_purchase` (not a collection, not an expense); till rebuilt from documents = stored.
- UI: "Bozordan LOM xarid qilish" on Kassam (seller, own till) and on Kassa (management chooses the seller); history with
  reversal. Manager = director; a seller sees only his own purchases. USD till not touched.
- The financial restart reverses 090 goods returns and 091 LOM purchases too; the 090 finished-goods guard lets only the
  restart / test-reset bulk statement through (flag set and cleared around that one statement).

## 3. Tests
| Check | Result |
|---|---|
| vitest (all) | 62 files / 521 tests PASS (091 suite 8/8) |
| tsc, next build | PASS; eslint: no new problems (24 old harness-file ones) |
| PG17 001 → 091 | postflights 073-091 all true; parity 203/203 |
| Rollback | 091 → 090 signature exact, → 089 exact; re-apply = 091; second apply no change; rollback refused while LOM purchases exist |
| Production-like copy 088 (2 orgs, one with the C2 defect) | auto release 088 → 089 → 090 → 091: full backup, restore, fingerprint, emergency rollback to 088, re-apply, postflights, RLS (2 orgs), parity — ALL PASS; balances / fingerprint unchanged |
| Staging E2E (rolled back) | `e2e_090_staging_rolledback.sql` 19/19, `e2e_091_staging_rolledback.sql` 7/7 locally (on 091) |
