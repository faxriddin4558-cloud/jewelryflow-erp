// Goldia Sales — the numbers on one seller card of /sales/app/sellers (P0 layout, 2026-11-18).
// Display only: every value is read from seller_gold_accounts exactly as the card showed it before; nothing is recomputed.
//   obligation: the signed "Bozor qarzi" of the card (seller owes the manager = negative, the manager owes = positive)
//   stock: the seller's physical goods (current_physical_stock_g); LOM / UZS / USD: the seller's till.

type Num = number | string | null | undefined;
const n = (v: Num) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

export type SellerAccountLike = {
  seller_owes_manager_g?: Num;
  manager_owes_seller_g?: Num;
  bozor_qarzi_signed_g?: Num;
  current_physical_stock_g?: Num;
  seller_till_scrap_grams?: Num;
  seller_till_cash_amount?: Num;
  seller_till_usd_amount?: Num;
};

export type SellerCardMetrics = {
  direction: "seller_owes" | "manager_owes" | "even";
  /** the obligation amount as the card shows it (always >= 0; the direction gives the sign) */
  obligationG: number;
  stockG: number;
  tillLomG: number;
  tillUzs: number;
  tillUsd: number;
};

// same rule as the card used before (DirectorSalesWorkspace, sellers tab)
export function sellerCardMetrics(acc: SellerAccountLike): SellerCardMetrics {
  const sellerOwes = n(acc.seller_owes_manager_g);
  const managerOwes = n(acc.manager_owes_seller_g);
  const signedDefined = acc.bozor_qarzi_signed_g !== undefined && acc.bozor_qarzi_signed_g !== null;
  const signed = n(acc.bozor_qarzi_signed_g);
  const isSellerDebtor = sellerOwes > 0.001 || (signedDefined && signed < -0.001);
  const isManagerDebtor = managerOwes > 0.001 || (signedDefined && signed > 0.001);
  const obligationG = isSellerDebtor ? (sellerOwes || Math.abs(signed)) : (managerOwes || signed);
  return {
    direction: isSellerDebtor ? "seller_owes" : isManagerDebtor ? "manager_owes" : "even",
    obligationG: isSellerDebtor || isManagerDebtor ? obligationG : 0,
    stockG: n(acc.current_physical_stock_g),
    tillLomG: n(acc.seller_till_scrap_grams),
    tillUzs: n(acc.seller_till_cash_amount),
    tillUsd: n(acc.seller_till_usd_amount),
  };
}
