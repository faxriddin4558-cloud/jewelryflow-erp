# Goldia Sales 084 — staging readiness report (2026-11-10)

**Production: STRICT READ-ONLY, untouched.** No deploy, migration or write SQL ran on production, staging, the JFS demo or the manufacturing ERP.

Every result below comes from the local production-shaped stand-in: PostgreSQL 17, GoTrue and PostgREST, plus the real Next.js build of this branch driven by Playwright. Evidence is in `evidence/local-084/` (`battery-SUMMARY.txt`, JSON results, screenshots, rehearsal logs).

## 1. Scope of 084 (confirmed rules)

**Owner decision 2026-11-10:**
- Seller, manager and director may enter or override any operation rate. No restriction, no approval.
- Saved rates are editable prefilled defaults.
- Every operation keeps rate, actor, time and audit history. No silent revaluation.
- The manager reviews the rates sellers used.

**What 084 does:**
- One rate rule: entered value, then default, then refused. Limits stay.
- Removes the hard-coded 12 800 / 880 000 / 900 000 rates.
- A baseline without USD stores no USD rate.
- Customer UZS / USD balances are added to profit and baseline.
- **Added today:**
  - the handover's entered-rate snapshot `gold_settlements.handover_entered_lom_rate`;
  - the read-only manager review `rpc_get_operation_rate_review` and its UI card on the sellers page;
  - postflight checks for both, and a rollback that is refused while snapshots exist.

No other accounting rule was changed.

## 2. Results

| Area | Test | Result |
|---|---|---|
| Rate entry, payment, currency debt, till, handover (real seller + manager Auth, UI) | rate-084: RR-1…RR-12 API, RR-UI-1 seller phone 585 payment, RR-UI-2 manager handover, RR-UI-3 seller USD-debt payment (till +632 500 once, debt 150, snapshot 12 650), RR-UI-4 manager rate review | **PASS 19/19** |
| Migration chain 081 → 082 → 083 → 084 (gated staging script, local rehearsal) | dry run + apply: per-migration postflight and fingerprint, history 3/3, level 084, no gaps | **PASS** |
| Schema parity with the repository 001..084 | missing 0, different bodies 0, extra 0 | **PASS** |
| Postflights 073…084 | all true (084: 12/12 columns) | **PASS** |
| RLS | read 10 030 checks, write 18 400 checks (200 users, 60 organizations) | **PASS** |
| Rollback rehearsal | emergency 084 → 083 → 082 → 081 on the copy, re-apply, balances and row counts unchanged | **PASS** |
| Rollback guard | rollback 084 with entered-rate snapshots present is refused, level stays 084 | **PASS** |
| Seller isolation | RLS above; stress attack cases (other seller's customer, other organization); review: a seller sees only his own rows, another seller's are refused | **PASS** |
| Manager / director parity | parity matrix: 0 mismatches, 0 missing; review: director rows = manager rows | **PASS** |
| Capital | ui-077 U77-02/03 (capital button, 3 000 000 once), ui-076 UI-17 (reversal of a cash operation) | **PASS** |
| Legacy debt / advance | ui-076 17/17, adv-081 11/11, stress-076 REC-LEG | **PASS** |
| Reversals | ret-083 (reversal blocked after returns), ui-077 U77-20, currency 13/13, stress-076 16/16 | **PASS** |
| FIFO | ret-083 28/28, stress-076 stock = held pieces | **PASS** (ret-083 first run 27/28: harness order dependence, fixed, re-run 28/28) |
| Currency sales | currency stress 13/13, ui-077 21/21 | **PASS** |
| Balances 082 / archive 078 / 079 / report race | balance-082 19/19, ui-078 10/10, da-079 14/14, report race 1/1 | **PASS** |
| vitest | 414/414 (includes the new 084 snapshot + review case) | **PASS** |
| TypeScript | `tsc --noEmit` exit 0 | **PASS** |
| Lint | `eslint src` clean. `npm run lint` (whole repo) has 24 problems in 6 old harness files under `docs/releases/` — identical on the committed baseline, untouched by 084. | **FAIL (pre-existing, not 084)** |
| Build | `next build` successful | **PASS** |
| Real staging | staging is at 081; 082 – 084 need the owner's release | **NOT TESTED** |
| Staging-only harnesses (stg-076-api, role matrix, integrity, recon-079, report-080, staging-077/078 extras) | need real staging | **NOT TESTED** |
| Production | read-only freeze | **NOT TOUCHED** |

## 3. Financial risks under the confirmed rules (BUSINESS DECISION REQUIRED)

Free rate entry is approved and stays. The items below are the remaining risks the owner must decide on. 084 changes none of them.

| # | Risk | How it works today (proven) | Decision needed |
|---|---|---|---|
| BD-1 | **Rate limits are the only automatic bound.** | Absolute min / max per organization (`seller_rate_limits`). The deviation rule (25 % from the official 585 rate) applies **only to a seller's LOM rate**, and only while an official rate exists. Manager / director LOM and every USD rate are bound only by min / max. The product default for USD is 5 000 – 30 000; the local test organizations hold 1 – 100 000 000, where 99 999 was accepted. | Set and confirm the limit values on staging and production. Decide whether the deviation rule should also cover USD and management. |
| BD-2 | **Who bears the rate difference.** | A payment at a typed rate clears `cash / rate` grams of customer debt. Those grams are captured in the seller's till and close the seller's obligation exactly at handover (072 rule). If the typed rate is below the official rate, the customer gets more grams for the money, and the difference falls on the company, not the seller. | Who carries the difference between the typed rate and the official rate: company or seller? Today: company. |
| BD-3 | **Handover of unvalued money.** | Cash and USD from currency (UZS / USD) sales carry no captured gram value. At handover, the rate typed there decides how much seller obligation they clear: a lower rate clears more grams. The entered rate is now snapshotted (`handover_entered_lom_rate`) and shown in the review. | Accept, or value currency-sale money at payment time (linked to D-C3). |
| BD-4 | **Override is reviewed after the fact, not blocked.** | The review flags "differs from saved" and the deviation from official per document and per seller. Nothing alerts or requires approval, as decided. | Who reviews, how often, and is there a % threshold the owner wants reported? |
| BD-5 | **Correcting a wrong rate.** | A rate is never edited: clients have no UPDATE, and no function rewrites a rate. The only correction is reversal (keeping who, when and why) plus a new document. | Confirm "reversal + new document" as the only correction path. |
| BD-6 | **Stale saved rates.** | A saved rate that is out of date is prefilled and accepted unchanged when the user does not edit it. | Should the UI warn when the saved rate is older than N days? |
| BD-7 | **A seller sets his own saved rate.** | The seller may change his saved default himself (072); the change is in `seller_rate_history`. | Confirm. |
| D-C3 | **Currency-sale profit / rate difference.** | Not defined; not computed and not guessed. | Which day's rate values a UZS / USD sale: sale, payment or handover? |
| BD-8 | **Report USD rate.** | The profit summary shows no period result while USD exists and no USD rate is given; a baseline needs a USD rate when customers or tills hold USD. After 084, a baseline confirmed before 084 must be confirmed again when currency sales exist. | Which USD rate source for reports (CBU or manual), and when to re-confirm the baseline. |

## 4. `.claude/settings.json`

See `CLAUDE-SETTINGS-RISK-AUDIT.md`. The current rules auto-approve:
- any Supabase MCP SQL;
- any `psql`;
- every `scripts/*.js` file, including ungated production scripts (`apply-prod-migration-0NN.js` run `supabase db push` with no typed confirmation; `apply-prod-migrations-001-042.js` even answers "y" automatically).

A staging-only variant is proposed: auto-allow only the local stand-in, ask for the rest, deny production / JFS / ERP refs and the ungated scripts, plus a hook that limits the MCP to the staging project. **Not applied** — the owner decides.

## 5. Verdict

- **Staging: GO** for the owner's release (081 → 082 → 083 → 084 plus frontend), with these conditions:
  1. check the rate limits on staging (BD-1);
  2. run the staging battery right after the release: rate-084, ret-083, balance-082, the 076–083 suites, the staging-only harnesses and recon-079. Unban the synthetic users before, re-ban them after.
- **Production: NO-GO.** It is frozen. Real-staging verification, the decisions in §3 and the owner's explicit approval are still missing.

Owner's staging command (own PowerShell window):

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target staging
```
