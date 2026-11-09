# Goldia Sales — rate simplification + currency accounting audit, migration 084

Date: 2026-11-09.

**Production FREEZE.** Production is at 080, strict read-only; nothing was deployed or migrated. Staging is still at 081, and 082 → 084 need the owner's staging release.

Everything below was proven on the local production-shaped stand-in, using the same gated release script that staging uses:
- PostgreSQL 17, GoTrue, PostgREST;
- the real Next.js frontend, driven by Playwright.

## 1. Owner requirements (2026-11-09)

- No compulsory or guessed rate anywhere: "Hech qayerda majburiy kurs bo'lmasin (12 800)".
- Every role may enter the LOM / USD rate for each payment and handover. The saved rate is only the default.
- Old documents keep their rate snapshot.
- Currency (UZS / USD) receivables must count in the profit summary.
- No profit figure is guessed where the business policy is not decided.

## 2. Root causes and severity

| # | Finding | Where (latest body before 084) | Severity | Effect |
|---|---|---|---|---|
| R1 | A seller's payment was forced to his saved rate. Another rate was refused with `ERR_RATE_MISMATCH`. | `rpc_record_client_settlement` (073), `rpc_record_client_currency_settlement` (077) | HIGH | A seller could not take a payment at the rate actually agreed with the customer. |
| R2 | A seller's handover was forced to the official daily rate (`_goldia_assert_seller_rate`). | `rpc_record_seller_to_manager_settlement` (073) | HIGH | Same as R1, for the handover. |
| R3 | Without the official daily rate, no cash could be taken at all (`ERR_DAILY_RATE_NOT_SET`). | client settlement, currency settlement, handover | HIGH | Work stopped on days when the official rate had not been entered. |
| R4 | Hard-coded rates were used as silent fallbacks. | Profit summary: USD **12 800**. `rpc_record_financial_transaction`: 585 **880 000** and USD **12 800**. Seller → factory cash: **900 000**. Sheets import: **900 000**. | HIGH | Money was converted at a rate nobody entered. The resulting figures look exact but are invented. |
| R5 | The baseline stored `usd_rate = 1.00` when the tills held no USD, because the column was NOT NULL. Most staging baselines show 1.00. | `rpc_confirm_accounting_baseline` (077), `accounting_baselines.usd_rate` | HIGH | The profit summary took the baseline's rate, so dollars received later were valued at **1 so'm**. |
| R6 | Customers' **UZS / USD debts and advances were missing** from the profit summary and from the baseline. | `rpc_get_accounting_profit_summary` (070), baseline (077) | HIGH | Profit and assets are understated by every open currency debt, and advances (liabilities) are ignored. 077 added currency sales, but the 070 summary was never extended. |
| R7 | Cash from currency-sale payments is not valued in the till pool. On handover it clears the seller's 585 obligation at the handover rate. | `client_currency_settlements` → till (072 pool trigger only covers `gold_settlements`) | Structural (decision) | The currency-sale profit / rate difference is **not defined** (decision gate D-C3, §5). It is not computed and not guessed. |

Already correct, no change needed:
- Every document keeps its rate snapshot: `gold_rate_applied`, `applied_usd_rate`, `rate_usd_uzs`, `rate_lom_uzs`, and the sale's `sale_usd_rate_snapshot`.
- Currency reversals check till balances in aggregate.

**Why currency debt was missing from profit (owner's question):** the omission was **not** a business choice. The profit summary is from 070, when only 585-gram debt existed. 077 introduced UZS / USD sales, but the summary was never updated. The omission is wrong: an open currency debt is an asset like a gram debt, and a currency advance is a liability. Fixed in 084 (R6).

## 3. Fix — migration 084 (minimal, no row changed)

- **One rate rule:** `_goldia_operation_rate(org, kind, role, sent, default)`.
  - The entered value is used first; otherwise the default is used.
  - The default is the seller's saved rate. Otherwise it is the official rate for LOM; USD has no official default.
  - With neither, the call is refused with `ERR_RATE_REQUIRED`. Nothing is guessed.
  - The organization's min / max limits still apply. A seller's LOM rate must also stay within `max_lom_deviation_pct` of the official rate, when an official rate exists.
  - The helper is not callable by clients.
- **Payments** (gram and currency) and the **handover** use the helper.
  - `ERR_RATE_MISMATCH` and `_goldia_assert_seller_rate` are removed.
  - On a handover, the entered rate values **only the unvalued (legacy) cash / USD**. Cash already valued at payment clears exactly its captured grams (rate-1 test: still 1 g).
- **Constants removed:**
  - financial transactions: money without a rate → `ERR_RATE_REQUIRED`;
  - seller → factory cash without a rate → refused;
  - a Sheets import row without `rate_per_g` → skipped;
  - profit summary: no 12 800.
- **Baseline:**
  - `usd_rate` is nullable and set to NULL when there are no dollars.
  - A USD rate is required while tills **or customers** hold USD.
  - The snapshot records currency receivables (`currency_receivables_included`, `uzs_receivable_total`, `usd_receivable_total`).
- **Profit summary:**
  - Customer UZS / USD debt is shown as assets and advance as liabilities, valued at the report's rates.
  - An amount without a rate is listed under `not_valued`, and the period result is **null** (status `not_valued`), never an estimate.
  - A baseline confirmed before 084, with older currency sales, gives no result until it is confirmed again.
- **UI:**
  - The seller payment dialog and the phone settle form show **editable** LOM / USD rate fields, prefilled with the saved rate.
  - The manager / director handover dialog has a LOM rate field with the official rate as default. It is required only for unvalued cash / USD.
- **Rollback 084:** restores every previous body and drops the helper. It re-adds NOT NULL only if no NULL `usd_rate` exists.

**Control risk (for the owner):** a seller-entered handover rate decides how much obligation the **unvalued** cash clears. The limits and the deviation rule bound it whenever an official rate exists. Payments made after 072 are valued at payment time and are not affected.

**USD has no official rate**, so for USD the organization's `usd_min_uzs` / `usd_max_uzs` limits are the only guard. The product default is 5 000 – 30 000. The local test organizations carry 1 – 100 000 000, so there a USD rate of 99 999 was accepted. The owner should check the limits in the rate settings on staging and production before release.

## 4. Evidence

Files are in `evidence/local-084/`.

| Test | Result |
|---|---|
| **rate-084**, local real Auth + UI: RR-1…RR-11 server checks, plus RR-UI-1 (seller phone at 390 px: saved rate prefilled and editable; typed 920 000 + double click gives exactly one payment, 1.0000 g) and RR-UI-2 (manager handover dialog: LOM field, official default, editable, till emptied) | **16/16** |
| Staging release rehearsal 081 → 082 → 083 → 084 (dry run + apply): backup, restore copy, per-migration postflight + fingerprint, postflights 073–084 all true, schema parity 001..084 = 0 differences, RLS read 10 030 / write 18 400 checks PASS, emergency rollback 084 → 083 → 082 → 081, re-apply, balances and business row counts unchanged | **PASS** |
| Postflight 084 on a fresh 001..084 stack | 10/10 true |
| Schema signature 083 → 084 | only the intended changes: helper, `usd_rate` nullable, 8 bodies |
| Regression 076–083 on 084: ret-083 (UI) 28/28, balance-082 (UI) 19/19, adv-081 11/11, ui-076 17/17, ui-077 21/21, ui-078 10/10, da-079 14/14, parity matrix 0 mismatches, currency 13/13, stress-076 16/16 | **PASS** |
| vitest | **413/413** |

Five older DB tests encoded the removed forced-rate rule (072, 065, 077). They were made 084-aware without weakening anything:
- accepted calls are proven in a rolled-back transaction;
- an absurd rate (1 so'm) is still refused, now with `ERR_RATE_OUT_OF_RANGE`;
- no rate and no saved rate still gives `ERR_RATE_REQUIRED`.

Two stress attack cases ("seller pays at another LOM / USD rate") now send an absurd rate (LOM 5 000 000, USD 200 000 000) and are still refused. Their first run on 084 failed because the plain "other" rate was accepted, which is the intended 084 behaviour.

The U77-14 UI check now expects the prefilled, editable rate field. Harnesses kept as evidence of older releases (075 / 073 dirs) still describe the old rule and are not re-run.

## 5. Decision gates (not computed, no figure guessed)

- **D-C3: profit / rate difference of currency sales.** A UZS / USD sale has no gram cost basis at sale time, and its cash is not valued in the till pool (R7). The owner must decide which rate defines its 585 value — sale day, payment day or handover day — before any currency-sale profit or rate difference is reported. Until then, currency receivables are shown at the report's rates as balances only.
- No cash refund rule is changed. The 083 advance-only decision stands.

## 6. Verdict

**Production: NO-GO** (freeze; staging verification and owner approval pending).

Staging is ready for the owner's release:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target staging
```

This detects 081 → 082 → 083 → 084 and deploys the frontend. The staging battery (rate-084, ret-083, balance-082, the 076–083 suites) follows.
