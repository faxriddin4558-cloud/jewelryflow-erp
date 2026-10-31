"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenGrams } from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";

interface MarkupDifferenceEntry {
  sale_id: string;
  sale_no: string;
  sale_date: string;
  seller_id: string;
  customer_name: string | null;
  model: string | null;
  base_weight_grams: number;
  assigned_seller_markup_pct: number | null;
  client_markup_pct: number | null;
  markup_difference_g: number | null;
  snapshot_source: "sale_time" | "reconstructed" | null;
  reversed: boolean;
}

interface MarkupDifferenceReport {
  total_difference_g: number;
  positive_g: number;
  negative_g: number;
  realized_g: number;
  unrealized_g: number;
  active_sales: number;
  reversed_sales: number;
  unknown_sales: number;
  note: string;
  by_seller: { seller_id: string; seller_name: string | null; total_difference_g: number; sales: number }[];
  entries: MarkupDifferenceEntry[];
}

// Signed grams: green "+" for positive, red "−" for negative.
function SignedGrams({ value, decimals = 4, className = "" }: { value: number | null; decimals?: number; className?: string }) {
  if (value === null || value === undefined) return <span className={`text-slate-400 ${className}`}>—</span>;
  const n = Number(value);
  const color = n > 0 ? "text-emerald-500" : n < 0 ? "text-rose-500" : "text-slate-400";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return <span className={`${color} ${className}`}>{sign}{formatScreenGrams(Math.abs(n), decimals)}</span>;
}

// "Ustama farqi": company pricing variance between the assigned seller markup and the markup the
// customer actually paid. Read-only; it never changes debts, obligations or profit.
export function MarkupDifferenceCard({ showBySeller = false }: { showBySeller?: boolean }) {
  const [report, setReport] = useState<MarkupDifferenceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sellerFilter, setSellerFilter] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("rpc_get_seller_markup_difference_report", {
      p_seller_id: sellerFilter || null,
      p_from: from || null,
      p_to: to || null,
    });
    if (rpcError) setError(parseErrorMessage(rpcError));
    else setReport(data as MarkupDifferenceReport);
  }, [from, to, sellerFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-[#0F172A] space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">📈 Ustama farqi</h2>
        {report && <SignedGrams value={report.total_difference_g} className="font-mono text-xl font-black" />}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <label className="flex items-center gap-1">Dan <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" /></label>
        <label className="flex items-center gap-1">Gacha <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" /></label>
        {showBySeller && report && (
          <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className="border rounded px-2 py-1">
            <option value="">Barcha sotuvchilar</option>
            {report.by_seller.map((s) => (
              <option key={s.seller_id} value={s.seller_id}>{s.seller_name || s.seller_id}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="text-xs text-rose-600" role="alert">Ustama farqini yuklab bo&apos;lmadi: {error}</div>}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div>Musbat: <SignedGrams value={report.positive_g} /></div>
            <div>Manfiy: <SignedGrams value={report.negative_g} /></div>
            <div>Amalga oshgan: <SignedGrams value={report.realized_g} /></div>
            <div>Hali to&apos;lanmagan: <SignedGrams value={report.unrealized_g} /></div>
          </div>
          <div className="text-[11px] text-slate-500">
            {report.active_sales} ta savdo, {report.reversed_sales} ta bekor qilingan
            {report.unknown_sales > 0 && `, ${report.unknown_sales} ta eski savdoda tayinlangan ustama noma'lum (hisobga olinmagan)`}. {report.note}
          </div>

          {showBySeller && !sellerFilter && report.by_seller.length > 0 && (
            <table className="w-full text-xs font-mono">
              <tbody>
                {report.by_seller.map((s) => (
                  <tr key={s.seller_id} className="border-t">
                    <td className="py-1">{s.seller_name || s.seller_id}</td>
                    <td className="text-right">{s.sales} ta</td>
                    <td className="text-right"><SignedGrams value={s.total_difference_g} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {report.entries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left">Sana</th>
                    <th className="text-left">Savdo</th>
                    <th className="text-left">Mijoz</th>
                    <th className="text-left">Model</th>
                    <th className="text-right">Vazn</th>
                    <th className="text-right">Tayinlangan</th>
                    <th className="text-right">Haqiqiy</th>
                    <th className="text-right">Farq</th>
                  </tr>
                </thead>
                <tbody>
                  {report.entries.slice(0, 100).map((e) => (
                    <tr key={e.sale_id} className={`border-t ${e.reversed ? "text-slate-400 line-through" : ""}`}>
                      <td>{e.sale_date}</td>
                      <td>{e.sale_no}{e.reversed ? " (bekor)" : ""}</td>
                      <td>{e.customer_name || "—"}</td>
                      <td>{e.model || "—"}</td>
                      <td className="text-right">{formatScreenGrams(e.base_weight_grams, 2)}</td>
                      <td className="text-right">{e.assigned_seller_markup_pct ?? "—"}%</td>
                      <td className="text-right">{e.client_markup_pct ?? "—"}%</td>
                      <td className="text-right"><SignedGrams value={e.markup_difference_g} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
