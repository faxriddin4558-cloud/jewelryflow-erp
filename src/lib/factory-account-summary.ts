// Goldia Sales — the factory account as shown on the director's factory page and the dashboard (migration 088).
// The real account is the manager vault: current_factory_obligation_g - current_factory_advance_g
//   > 0: the manager owes the factory; < 0: the factory owes the manager; 0: closed.
// The cards explain it from its parts:
//   goods debt   = active receipts' factory_obligation_g - active factory_settled documents (seller goods settled before T0)
//   C            = active factory_obligation opening documents (obligation without goods)
//   given gold   = C2 (active factory_advance opening documents) + active handovers' agreed_equivalent_g
//   goods debt + C - given gold must equal the vault net (a difference is shown, never hidden).

export const FACTORY_ACCOUNT_EPS = 0.0001;

type Num = number | string | null | undefined;
const n = (v: Num) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

export type FactoryReceiptLike = { status?: string | null; factory_obligation_g?: Num; original_physical_g?: Num };
export type FactoryHandoverLike = { status?: string | null; agreed_equivalent_g?: Num };
export type OpeningFactoryDocLike = { kind: string; status?: string | null; amount?: Num };
export type FactoryVaultLike = { current_factory_obligation_g?: Num; current_factory_advance_g?: Num } | null | undefined;

export type FactoryNetDirection = "manager_owes_factory" | "factory_owes_manager" | "closed";

export type FactoryAccountSummary = {
  receivedPhysicalG: number;
  receiptsObligationG: number;
  settledSellerGoodsG: number;
  goodsDebtG: number;
  obligationWithoutGoodsG: number;
  advanceDocumentsG: number;
  handoversG: number;
  givenGoldG: number;
  partsNetG: number;
  vaultNetG: number | null;
  mismatchG: number | null;
};

export function summarizeFactoryAccount(input: {
  receipts: FactoryReceiptLike[];
  handovers: FactoryHandoverLike[];
  openingDocs: OpeningFactoryDocLike[];
  vault: FactoryVaultLike;
}): FactoryAccountSummary {
  const receipts = input.receipts.filter((r) => r.status !== "reversed");
  const handovers = input.handovers.filter((h) => h.status !== "reversed");
  const docs = input.openingDocs.filter((d) => (d.status ?? "active") === "active");
  const sumKind = (k: string) => docs.filter((d) => d.kind === k).reduce((s, d) => s + n(d.amount), 0);

  const receivedPhysicalG = receipts.reduce((s, r) => s + n(r.original_physical_g), 0);
  const receiptsObligationG = receipts.reduce((s, r) => s + n(r.factory_obligation_g), 0);
  const settledSellerGoodsG = sumKind("factory_settled");
  const goodsDebtG = receiptsObligationG - settledSellerGoodsG;
  const obligationWithoutGoodsG = sumKind("factory_obligation");
  const advanceDocumentsG = sumKind("factory_advance");
  const handoversG = handovers.reduce((s, h) => s + n(h.agreed_equivalent_g), 0);
  const givenGoldG = advanceDocumentsG + handoversG;
  const partsNetG = goodsDebtG + obligationWithoutGoodsG - givenGoldG;
  const vaultNetG = input.vault ? n(input.vault.current_factory_obligation_g) - n(input.vault.current_factory_advance_g) : null;
  const mismatchG = vaultNetG === null ? null : partsNetG - vaultNetG;
  return {
    receivedPhysicalG, receiptsObligationG, settledSellerGoodsG, goodsDebtG, obligationWithoutGoodsG,
    advanceDocumentsG, handoversG, givenGoldG, partsNetG, vaultNetG, mismatchG,
  };
}

export function isFactoryAccountMismatch(s: Pick<FactoryAccountSummary, "mismatchG">): boolean {
  return s.mismatchG !== null && Math.abs(s.mismatchG) > FACTORY_ACCOUNT_EPS;
}

/** Sign wording of the factory account (vault net): positive = the manager owes the factory. */
export function factoryNetWording(net: number | null | undefined): { direction: FactoryNetDirection; title: string; amountG: number } {
  const v = n(net);
  if (Math.abs(v) < FACTORY_ACCOUNT_EPS / 2) return { direction: "closed", title: "Zavod bilan hisob yopiq", amountG: 0 };
  if (v > 0) return { direction: "manager_owes_factory", title: "Menejerning zavodga qarzi", amountG: v };
  return { direction: "factory_owes_manager", title: "Zavodning menejerga qarzi", amountG: -v };
}
