// Goldia Sales 089 (2026-11-18) — display / input helpers for the old-sale return, payment correction, till count and
// stock movement screens. Nothing here computes a stored balance: the server does (preview RPC, record RPCs).

const num = (v: unknown) => { const x = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(x) ? x : NaN; };

/** journal row type -> badge text */
export function ledgerTypeLabel(txType: string): string {
  switch (txType) {
    case "sale": return "🛍️ Savdo";
    case "return": return "↩️ Vozvrat";
    case "opening_return": return "↩️ Eski savdo vozvrati";
    case "currency_payment": return "💵 CPAY (so'm / dollar qarz)";
    case "legacy_debt": return "📋 Eski qarz";
    default: return "💰 To'lov (SETTL, 585 g)";
  }
}

/** stock movement kind -> label */
export const STOCK_KIND_LABEL: Record<string, string> = {
  opening_inventory: "Boshlang'ich qoldiq (B)",
  consignment: "Yangi konsignatsiya",
  old_sale_return: "Eski savdodan vozvrat",
  customer_return: "Mijoz vozvrati",
  sale: "Sotuv",
  sale_reversed: "Sotuv bekor qilindi",
  return_to_manager: "Menejerga qaytarildi",
  consignment_cancelled: "Konsignatsiya bekor qilindi",
};

export type TillDiff = { diffUzs: number; diffUsd: number; kind: "match" | "short" | "surplus" };
/** counted cash vs the till the seller must hand over; "short" if either currency is below the till */
export function tillCountDiff(expectedUzs: unknown, expectedUsd: unknown, countedUzs: unknown, countedUsd: unknown): TillDiff | null {
  const eu = num(expectedUzs), ed = num(expectedUsd), cu = num(countedUzs), cd = num(countedUsd);
  if (![eu, ed, cu, cd].every(Number.isFinite) || cu < 0 || cd < 0) return null;
  const diffUzs = Math.round((cu - eu) * 100) / 100, diffUsd = Math.round((cd - ed) * 100) / 100;
  return { diffUzs, diffUsd, kind: diffUzs === 0 && diffUsd === 0 ? "match" : diffUzs < 0 || diffUsd < 0 ? "short" : "surplus" };
}

export type CorrectionInput = {
  newKind: "SETTL" | "CPAY"; currency: "UZS" | "USD"; cashUzs: string; usdAmount: string; lomRate: string; usdRate: string; notes?: string;
};
/** the p_new payload of rpc_correct_client_payment, or the reason it cannot be sent (no amount is guessed or converted) */
export function buildCorrectionPayload(i: CorrectionInput): { payload: Record<string, unknown> } | { error: string } {
  const cash = i.cashUzs.trim() ? num(i.cashUzs) : 0, usd = i.usdAmount.trim() ? num(i.usdAmount) : 0;
  const lom = i.lomRate.trim() ? num(i.lomRate) : null, ur = i.usdRate.trim() ? num(i.usdRate) : null;
  if (!Number.isFinite(cash) || !Number.isFinite(usd) || cash < 0 || usd < 0) return { error: "Summalar musbat son bo'lishi kerak" };
  if (cash === 0 && usd === 0) return { error: "Mijoz bergan so'm yoki dollar summasini kiriting" };
  if ((lom !== null && !(lom > 0)) || (ur !== null && !(ur > 0))) return { error: "Kurslar musbat son bo'lishi kerak" };
  if (i.newKind === "SETTL") {
    if (cash > 0 && lom === null) return { error: "585 gramm qarzi uchun so'm to'lovida 585 kursi shart" };
    if (usd > 0 && (ur === null || lom === null)) return { error: "585 gramm qarzi uchun dollar to'lovida USD va 585 kurslari shart" };
  } else {
    if (i.currency === "UZS" && usd > 0 && ur === null) return { error: "So'm qarziga dollar to'lansa USD kursi shart" };
    if (i.currency === "USD" && cash > 0 && ur === null) return { error: "Dollar qarziga so'm to'lansa USD kursi shart" };
  }
  const payload: Record<string, unknown> = { cash_uzs: cash, usd_amount: usd };
  if (i.newKind === "CPAY") payload.currency = i.currency;
  if (lom !== null) payload.lom_rate = lom;
  if (ur !== null) payload.usd_rate = ur;
  if (i.notes && i.notes.trim()) payload.notes = i.notes.trim();
  return { payload };
}

export const newIdemKey = (prefix: string) =>
  `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
