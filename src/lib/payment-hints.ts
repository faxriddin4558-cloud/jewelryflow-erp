// Goldia Sales — display hints for the payment dialogs (SETTL = 585 gram debt, CPAY = UZS / USD debt), 2026-11-18.
// Display only: nothing here is sent to the server or changes an amount.

const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** USD x USD rate in so'm (preview line under the USD field); null when either is missing */
export function usdToUzsPreview(usd: unknown, usdRate: unknown): number | null {
  const u = num(usd), r = num(usdRate);
  return u > 0 && r > 0 ? Math.round(u * r) : null;
}

/**
 * A so'm amount that is exactly a whole number of dollars at the given USD rate (at least 10 USD) is probably dollars
 * already multiplied by the rate. Returns that number of dollars, else null.
 */
export function wholeDollarsInUzs(cashUzs: unknown, usdRate: unknown): number | null {
  const c = num(cashUzs), r = num(usdRate);
  if (c <= 0 || r <= 0 || c < 10 * r) return null;
  const n = Math.round(c / r);
  return Math.abs(n * r - c) < 1 ? n : null;
}

export const SETTL_SCOPE_TEXT = "Bu to'lov mijozning 585 GRAMM qarzini yopadi (SETTL). So'm yoki dollar qarzi bo'lsa — «Valyuta qarzi» oynasidan to'lang. Bitta to'lovni ikkala oynaga yozmang.";
export const cpayScopeText = (currency: string) =>
  `Bu to'lov mijozning ${currency} QARZINI yopadi (CPAY). 585 gramm qarzi uchun «Mijoz to'lovi» oynasidan foydalaning. Bitta to'lovni ikkala oynaga yozmang.`;
export const wholeDollarsWarning = (n: number) =>
  `Bu so'm summasi aniq ${n.toLocaleString("en-US")} USD ga teng. Mijoz dollar bergan bo'lsa, uni «Mijoz bergan DOLLAR» maydoniga yozing (so'mga aylantirmang).`;
