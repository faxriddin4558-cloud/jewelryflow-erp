"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/erp-engine";
import { useSessionUser } from "@/lib/use-session-user";
import { isSellerUiRole } from "@/lib/sales-role-access";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";
import { SellerRatesCard } from "@/components/sales/SellerRatesCard";
import { SellerMobileWorkspace } from "@/components/sales/SellerMobileWorkspace";

type Handover = {
  id: string; settlement_no: string; created_at: string; status: string; cash_paid_amount: number; usd_paid_amount: number;
  scrap_weight_grams: number; total_settled_grams: number;
};

// Kassam: own till (UZS, USD, scrap), own rates and the handovers the manager recorded for this seller.
// Handing the till over stays a manager-recorded workflow.
export default function KassamPage() {
  const [rows, setRows] = useState<Handover[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const user = useSessionUser();
  const isSeller = isSellerUiRole(user?.role);
  useEffect(() => {
    void (async () => {
      const { data: empId } = await supabase.rpc("current_employee_id");
      if (!empId) return;
      const { data } = await supabase
        .from("gold_settlements")
        .select("id, settlement_no, created_at, status, cash_paid_amount, usd_paid_amount, scrap_weight_grams, total_settled_grams")
        .eq("seller_id", empId)
        .eq("direction", "seller_to_manager")
        .order("created_at", { ascending: false })
        .limit(20);
      setRows((data ?? []) as Handover[]);
    })();
  }, []);

  if (!user) return null;
  if (!isSeller) {
    return (
      <div className="text-sm text-slate-300 p-4">
        Bu sahifa sotuvchining o&apos;z kassasi uchun. Kassa va sotuvchilar kurslari: <Link href="/sales/app/cash" className="text-amber-400 font-bold">Kassa &amp; Valyuta</Link>.
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <h1 className="text-lg font-black text-white rounded-2xl bg-slate-900 border border-slate-800 p-4">🏦 Kassam</h1>
      <SellerRatesCard onChanged={() => setReloadKey((k) => k + 1)} />
      <SellerMobileWorkspace key={reloadKey} tabs={["till"]} initialTab="till" />
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
        <div className="text-[11px] uppercase font-bold tracking-wide text-slate-400 mb-2">Boshqaruvchiga topshirishlar</div>
        <p className="text-[11px] text-slate-500 mb-2">Topshirishni boshqaruvchi qabul qilib yozadi. Yozilgan topshirish sizning bozor qarzingizni yopadi.</p>
        {rows.length === 0 ? (
          <div className="text-xs text-slate-500">Hozircha topshirish yo&apos;q</div>
        ) : (
          <ul className="divide-y divide-slate-800 text-xs" data-testid="handover-history">
            {rows.map((r) => (
              <li key={r.id} className={`py-2 flex flex-wrap justify-between gap-2 ${r.status === "reversed" ? "line-through text-slate-500" : "text-slate-200"}`}>
                <span>{r.settlement_no} · {new Date(r.created_at).toLocaleDateString("ru-RU")}</span>
                <span className="font-mono">
                  {Number(r.cash_paid_amount) > 0 && `${formatScreenUZS(r.cash_paid_amount)} `}
                  {Number(r.usd_paid_amount) > 0 && `${Number(r.usd_paid_amount)} USD `}
                  {Number(r.scrap_weight_grams) > 0 && `${formatScreenGrams(r.scrap_weight_grams, 3)} lom `}
                  → {formatScreenGrams(r.total_settled_grams, 3)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
