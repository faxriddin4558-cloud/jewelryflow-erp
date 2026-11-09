// Which LOM/USD rates the Goldia Sales payment and till-handover dialogs pre-fill.
// 084: every role may enter the LOM / USD rate of each payment and handover; the saved rate (seller) or the official
// rate (director / manager) is only the pre-filled default. The server checks the organization's limits and stores the
// rate on the document. rpc_record_seller_to_manager_settlement closes cash/USD collected since 072 at the grams
// captured when the customer paid and needs a rate only for cash / dollars without a captured value.

export const SELLER_ROLES = ["seller", "sotuvchi", "sales"];

export function isSellerRole(role: string | null | undefined): boolean {
  return SELLER_ROLES.includes(String(role || "").toLowerCase());
}

export interface OwnRates {
  lom: number | null;
  usd: number | null;
}

export interface PaymentRatePrefill {
  lom: string;
  usd: string;
  /** 084: always false - the pre-filled rate can be changed for this operation */
  locked: boolean;
  source: "seller_own" | "official_and_cbu";
}

/** Reads the calling seller's own stored rates from the rpc_get_seller_rates payload (a seller only sees his own row). */
export function ownRatesFromRpc(payload: unknown): OwnRates {
  const sellers = (payload as { sellers?: { lom_rate_uzs?: number | string | null; usd_rate_uzs?: number | string | null }[] } | null)?.sellers ?? [];
  const row = sellers[0];
  const num = (v: number | string | null | undefined) => (v !== null && v !== undefined && Number(v) > 0 ? Number(v) : null);
  return { lom: num(row?.lom_rate_uzs), usd: num(row?.usd_rate_uzs) };
}

/**
 * Seller: own stored LOM and USD rate (works when the CBU service is down). Without an own LOM rate the server falls
 * back to the official rate, so the official rate is shown; without an own USD rate the field stays empty because the
 * server refuses dollars until the seller sets one (no CBU guess for sellers).
 * Director / manager: unchanged behaviour (official LOM rate, CBU USD rate, editable).
 */
export function pickPaymentRates(input: {
  role: string | null | undefined;
  ownRates: OwnRates | null;
  officialRate: number | null;
  cbuUsdRate: number | null;
}): PaymentRatePrefill {
  const s = (v: number | null | undefined) => (v && v > 0 ? String(v) : "");
  if (isSellerRole(input.role)) {
    return {
      lom: s(input.ownRates?.lom ?? input.officialRate),
      usd: s(input.ownRates?.usd ?? null),
      locked: false,
      source: "seller_own",
    };
  }
  return { lom: s(input.officialRate), usd: s(input.cbuUsdRate), locked: false, source: "official_and_cbu" };
}

export interface TillValuation {
  tillCash: number;
  tillUsd: number;
  /** dollars collected since 072, already valued in grams at payment time */
  valuedUsd: number;
  valuedUsdGrams: number;
  valuedCash: number;
  valuedCashGrams: number;
  /** older dollars without a captured value: only these need a USD rate */
  unvaluedUsd: number;
  usdRateRequired: boolean;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Mirrors the server split (073 rpc_record_seller_to_manager_settlement): valued part = min(till, valued pool). */
export function tillValuation(acc: {
  seller_till_cash_amount?: unknown;
  seller_till_usd_amount?: unknown;
  till_valued_cash_uzs?: unknown;
  till_valued_cash_585_g?: unknown;
  till_valued_usd?: unknown;
  till_valued_usd_585_g?: unknown;
}): TillValuation {
  const tillCash = Math.max(0, n(acc.seller_till_cash_amount));
  const tillUsd = Math.max(0, n(acc.seller_till_usd_amount));
  const poolCash = Math.min(Math.max(0, n(acc.till_valued_cash_uzs)), tillCash);
  const poolUsd = Math.min(Math.max(0, n(acc.till_valued_usd)), tillUsd);
  const cashG = n(acc.till_valued_cash_uzs) > 0 ? (n(acc.till_valued_cash_585_g) * poolCash) / n(acc.till_valued_cash_uzs) : 0;
  const usdG = n(acc.till_valued_usd) > 0 ? (n(acc.till_valued_usd_585_g) * poolUsd) / n(acc.till_valued_usd) : 0;
  const unvaluedUsd = Math.round((tillUsd - poolUsd) * 100) / 100;
  return {
    tillCash, tillUsd, valuedUsd: poolUsd, valuedUsdGrams: Math.round(usdG * 10000) / 10000,
    valuedCash: poolCash, valuedCashGrams: Math.round(cashG * 10000) / 10000,
    unvaluedUsd: Math.max(0, unvaluedUsd), usdRateRequired: unvaluedUsd > 0,
  };
}

/** USD rate pre-filled in the handover dialog: the seller's stored USD rate, else the CBU rate, else empty. */
export function pickHandoverUsdRate(sellerUsdRate: number | null | undefined, cbuUsdRate: number | null | undefined): string {
  if (sellerUsdRate && sellerUsdRate > 0) return String(sellerUsdRate);
  if (cbuUsdRate && cbuUsdRate > 0) return String(cbuUsdRate);
  return "";
}
