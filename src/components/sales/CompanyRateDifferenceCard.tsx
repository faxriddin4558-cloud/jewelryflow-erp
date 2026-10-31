"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";

interface RateDifferenceEntry {
  id: string;
  created_at: string;
  entry_type: "purchase" | "purchase_reversal";
  purchase_no: string;
  valued_cash_uzs: number;
  avg_conversion_rate: number | null;
  purchase_rate_per_gram: number | null;
  physical_grams: number;
  proba: number | null;
  accounting_value_585_g: number;
  valued_purchased_585_g: number;
  difference_585_g: number;
}

interface RateDifferenceReport {
  net_difference_585_g: number;
  gain_585_g: number;
  loss_585_g: number;
  valued_cash_pool_uzs: number;
  valued_cash_pool_585_g: number;
  pool_avg_conversion_rate: number | null;
  note: string;
  entries: RateDifferenceEntry[];
}

// Company (GOLDIA) gain/loss when cash received from sellers at one rate is spent on scrap at another.
// Read-only: the figures are already inside the profit summary and are never added to it again.
export function CompanyRateDifferenceCard() {
  const [report, setReport] = useState<RateDifferenceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error: rpcError } = await supabase.rpc("rpc_get_company_rate_difference_report");
      if (!active) return;
      if (rpcError) setError(parseErrorMessage(rpcError));
      else setReport(data as RateDifferenceReport);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <div className="text-[11px] text-rose-300" role="alert">Kurs farqi hisobotini yuklab bo&apos;lmadi: {error}</div>;
  }
  if (!report) return null;

  const net = Number(report.net_difference_585_g || 0);
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 text-slate-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Kompaniya kurs farqi (naqd → lom xaridi)</div>
        <div className={`font-mono text-lg font-black ${net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
          {net >= 0 ? "+" : ""}{formatScreenGrams(net, 4)}
        </div>
      </div>
      <div className="mt-1 text-[11px] text-slate-400 font-mono">
        Foyda: +{formatScreenGrams(report.gain_585_g, 4)} | Zarar: {formatScreenGrams(report.loss_585_g, 4)} | Baholangan naqd:{" "}
        {formatScreenUZS(report.valued_cash_pool_uzs)} = {formatScreenGrams(report.valued_cash_pool_585_g, 4)}
        {report.pool_avg_conversion_rate ? ` (o'rtacha ${formatScreenUZS(report.pool_avg_conversion_rate)}/g)` : ""}
      </div>
      <div className="mt-1 text-[10px] text-slate-500">{report.note}</div>
      {report.entries.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead className="text-slate-400">
              <tr>
                <th className="text-left font-semibold">Xarid</th>
                <th className="text-right font-semibold">Naqd</th>
                <th className="text-right font-semibold">Qabul kursi</th>
                <th className="text-right font-semibold">Xarid kursi</th>
                <th className="text-right font-semibold">Hisob g</th>
                <th className="text-right font-semibold">Olingan g (585)</th>
                <th className="text-right font-semibold">Farq</th>
              </tr>
            </thead>
            <tbody>
              {report.entries.slice(0, 10).map((e) => (
                <tr key={e.id} className={e.entry_type === "purchase_reversal" ? "text-slate-500" : ""}>
                  <td className="text-left">{e.purchase_no}{e.entry_type === "purchase_reversal" ? " (bekor)" : ""}</td>
                  <td className="text-right">{formatScreenUZS(e.valued_cash_uzs)}</td>
                  <td className="text-right">{e.avg_conversion_rate ? formatScreenUZS(e.avg_conversion_rate) : "—"}</td>
                  <td className="text-right">{e.purchase_rate_per_gram ? formatScreenUZS(e.purchase_rate_per_gram) : "—"}</td>
                  <td className="text-right">{formatScreenGrams(e.accounting_value_585_g, 4)}</td>
                  <td className="text-right">{formatScreenGrams(e.valued_purchased_585_g, 4)}</td>
                  <td className={`text-right ${Number(e.difference_585_g) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {Number(e.difference_585_g) >= 0 ? "+" : ""}{formatScreenGrams(e.difference_585_g, 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
