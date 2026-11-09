// Canonical customer balance model (585 gram, UZS and USD are NEVER added together; each unit has its own totals).
//
// Per customer and unit, the database keeps a gross debt column and a gross advance column (client_gold_accounts:
// current_debt_grams / advance_balance_grams; client_currency_accounts: debt_amount / advance_amount). The server keeps
// at most one of them above zero, but the display must not depend on that:
//   signedNet   = debt - advance          (> 0: the customer owes us, < 0: we owe the customer)
//   openDebt    = max(0,  signedNet)      (what the customer still has to pay)
//   openAdvance = max(0, -signedNet)      (what we hold for the customer)
// Totals are the sums of the per-customer parts:
//   grossDebt   = SUM(openDebt)
//   grossAdvance= SUM(openAdvance)
//   signedNet   = grossDebt - grossAdvance  (= SUM(debt) - SUM(advance))
// The advance is subtracted exactly once (inside signedNet). A negative total is shown as "Biz mijozlarga qarzdormiz",
// never clamped to 0. Customer advances never change the seller's obligation ("Bozor qarzi"): that is a seller account.

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export interface CustomerBalance {
  signedNet: number;
  openDebt: number;
  openAdvance: number;
}

export function customerBalance(debt: unknown, advance: unknown): CustomerBalance {
  const signedNet = r4(num(debt) - num(advance));
  return { signedNet, openDebt: signedNet > 0 ? signedNet : 0, openAdvance: signedNet < 0 ? r4(-signedNet) : 0 };
}

export interface BalanceTotals {
  grossDebt: number;
  grossAdvance: number;
  signedNet: number;
  debtors: number;
  creditors: number;
}

export function balanceTotals<T>(rows: readonly T[] | null | undefined, debtOf: (r: T) => unknown, advanceOf: (r: T) => unknown): BalanceTotals {
  let grossDebt = 0;
  let grossAdvance = 0;
  let debtors = 0;
  let creditors = 0;
  for (const r of rows ?? []) {
    const b = customerBalance(debtOf(r), advanceOf(r));
    grossDebt += b.openDebt;
    grossAdvance += b.openAdvance;
    if (b.openDebt > 0) debtors++;
    if (b.openAdvance > 0) creditors++;
  }
  grossDebt = r4(grossDebt);
  grossAdvance = r4(grossAdvance);
  return { grossDebt, grossAdvance, signedNet: r4(grossDebt - grossAdvance), debtors, creditors };
}

// Gram columns of client_gold_accounts, including the older aliases some queries still return.
export const goldDebtOf = (r: { current_debt_grams?: unknown; current_gold_debt_grams?: unknown }) =>
  r.current_debt_grams ?? r.current_gold_debt_grams ?? 0;
export const goldAdvanceOf = (r: { advance_balance_grams?: unknown; advance_gold_balance_grams?: unknown }) =>
  r.advance_balance_grams ?? r.advance_gold_balance_grams ?? 0;

/** Wording for a signed total: who owes whom. */
export function netDirectionLabel(signedNet: number): string {
  if (signedNet > 0) return "Mijozlar bizga qarzdor";
  if (signedNet < 0) return "Biz mijozlarga qarzdormiz";
  return "Hisob-kitob teng";
}
