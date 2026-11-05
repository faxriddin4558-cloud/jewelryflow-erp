# 077 — business decisions that are NOT assumed in code

Each gate shows what 077 does today (the safe default) and what is NOT done until the owner decides.

| Gate | Question | 077 today | Not done |
|---|---|---|---|
| D-P1 | May the manager run the TEST reset / cleanup (wipes data)? | director only (unchanged) | — |
| D-C1 | At which rate does UZS / USD from a currency sale reduce the seller's 585 obligation when he hands the till over? | existing 072 handover rule: unvalued cash is converted at the LOM / USD rate entered on that handover (default: official 585 rate); the rate is stored on the handover row | no automatic "sale-time" rate |
| D-C2 | Customer pays a USD debt with UZS (or the reverse) or with scrap: which rate? | seller: his own approved LOM / USD rates (server-checked); director / manager: must type the rate; the rate is stored on the payment | no CBU / market rate is applied automatically |
| D-C3 | Profit, rate difference, stone / brilliant value, company share of a UZS / USD sale | NOT computed; the period report says so | no profit figure, no allocation |
| D-C4 | Overpayment of a currency debt | advance in the same currency (used first by the next sale in that currency) | not moved to the 585 gram debt |
| D-C5 | Does a currency sale change the seller's 585 obligation? | no — it stays grams × (1 + seller %) until handovers close it | — |
| D-A1 (078) | May a customer who is archived ("o'chirilgan") still receive a new sale? | hidden from the UI lists / sale picker; the server does not refuse it | no server-side refusal |
| D-A2 (078) | May a seller take an unassigned customer for himself (direct write, since 038)? | allowed (unchanged); archiving an unassigned customer is management-only | not restricted |

Example (owner's): manager gives 20 g at 10 % → seller owes 22 g (585). Seller sells for $2 000 → stock −20 g, customer owes
$2 000, seller still owes 22 g. Customer pays $2 000 → seller till +$2 000. Manager takes the till at, e.g., 12 500 UZS/USD
and 900 000 UZS/g → 2 000 × 12 500 / 900 000 = 27.7778 g closes the 22 g and leaves 5.7778 g in the seller's favour
(D-C1 decides that rate; D-C3 decides whether / how that surplus is profit and whose).
