import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export const GoldEngine = {
  toFineGold(grossWeight: number, assay: number): number {
    const w = Number(grossWeight) || 0, p = Number(assay) || 0;
    return w > 0 && p > 0 ? Number(((w * p) / 1000).toFixed(2)) : 0;
  },
  calculateAlloy(inputWeight: number, currentAssay: number, targetAssay: number, newRatio = 70) {
    const w = Number(inputWeight) || 0, cA = Number(currentAssay) || 999, tA = Number(targetAssay) || 585;
    const fineGold = this.toFineGold(w, cA);
    if (w <= 0 || tA <= 0) return { fineGold: 0, requiredLigature: 0, requiredPureGold: 0, totalOutputWeight: 0, newGoldShare: 0, oldGoldShare: 0 };
    if (cA >= tA) {
      const totalOutputWeight = Number(((w * cA) / tA).toFixed(2));
      const requiredLigature = Number(Math.max(0, totalOutputWeight - w).toFixed(2));
      return {
        fineGold, requiredLigature, requiredPureGold: 0, totalOutputWeight,
        newGoldShare: Number(((totalOutputWeight * newRatio) / 100).toFixed(2)),
        oldGoldShare: Number(((totalOutputWeight * (100 - newRatio)) / 100).toFixed(2))
      };
    } else {
      const requiredPureGold = Number(((w * (tA - cA)) / (999 - tA)).toFixed(2));
      const totalOutputWeight = Number((w + requiredPureGold).toFixed(2));
      return { fineGold, requiredLigature: 0, requiredPureGold, totalOutputWeight, newGoldShare: totalOutputWeight, oldGoldShare: 0 };
    }
  },
  verifyMassBalance(p: { inputGold: number; goodProduct: number; sprue: number; scrap: number; rework: number; loss: number; remainingWip: number; toleranceGrams?: number }) {
    const input = Number(p.inputGold) || 0;
    const accounted = Number(((Number(p.goodProduct) || 0) + (Number(p.sprue) || 0) + (Number(p.scrap) || 0) + (Number(p.rework) || 0) + (Number(p.loss) || 0) + (Number(p.remainingWip) || 0)).toFixed(2));
    const discrepancy = Number((input - accounted).toFixed(2));
    const isBalanced = Math.abs(discrepancy) <= (p.toleranceGrams ?? 0.05);
    return {
      input, accounted, discrepancy, isBalanced,
      statusText: isBalanced ? "✅ BALANCED" : `🔴 MASS BALANCE ERROR (${discrepancy > 0 ? "-" : "+"}${Math.abs(discrepancy).toFixed(2)}g)`
    };
  }
};

export type ErpRole = "Director" | "Production Manager" | "Supervisor" | "Department Head" | "Accountant" | "Warehouse" | "Worker";

export const RBAC = {
  getCurrentUser(): { name: string; role: ErpRole; department: string } {
    if (typeof window !== "undefined") {
      const s = localStorage.getItem("erp_active_user");
      if (s) { try { return JSON.parse(s); } catch {} }
    }
    return { name: "Faxriddin Xojayev", role: "Director", department: "Boshqaruv" };
  },
  setCurrentUser(u: { name: string; role: ErpRole; department: string }) {
    if (typeof window !== "undefined") localStorage.setItem("erp_active_user", JSON.stringify(u));
  },
  can(action: "edit_inventory" | "edit_sales" | "edit_salary_rate" | "create_batch" | "approve_qc"): boolean {
    const { role } = this.getCurrentUser();
    if (role === "Director") return true;
    if (action === "edit_inventory") return role === "Warehouse" || role === "Production Manager";
    if (action === "edit_sales") return role === "Accountant";
    if (action === "edit_salary_rate") return role === "Accountant" || role === "Production Manager";
    if (action === "create_batch") return role === "Production Manager" || role === "Supervisor";
    if (action === "approve_qc") return role === "Supervisor" || role === "Department Head" || role === "Production Manager";
    return false;
  }
};

export async function logErpAudit(p: { table: string; recordId?: string; action: string; oldData?: any; newData?: any; reason?: string }) {
  const u = RBAC.getCurrentUser();
  await supabase.from("audit_logs").insert([{
    table_name: p.table, record_id: p.recordId || "", action: p.action,
    actor_name: u.name, actor_role: u.role, old_data: p.oldData || null, new_data: p.newData || null, reason: p.reason || ""
  }]);
}
