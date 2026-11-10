"use client";

// Goldia Sales — review of the rates actually used per operation (migration 084, business decision 2026-11-10).
// Seller, manager and director may type / override the rate of a payment or handover; every document keeps the rate,
// actor and time it was recorded with (never revalued). This read-only table lets the manager / director see, per
// seller, which rate was used, the seller's saved rate and the official 585 rate in force at that moment.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { parseErrorMessage } from "@/lib/error-utils";

type ReviewRow = {
  kind: string; id: string; doc_no: string | null; doc_date: string; created_at: string;
  seller_id: string; seller_name: string | null; customer_name: string | null;
  recorded_by_name: string | null; recorded_by_role: string | null; status: string;
  cash_uzs: number | null; usd: number | null; grams: number | null; debt_currency: string | null;
  lom_rate: number | null; usd_rate: number | null; effective_rate: number | null;
  saved_lom_rate: number | null; saved_usd_rate: number | null; official_lom_rate: number | null;
  lom_differs_from_saved: boolean; usd_differs_from_saved: boolean; lom_deviation_from_official_pct: number | null;
};
type Review = {
  start_date: string; end_date: string; truncated: boolean; rows: ReviewRow[];
  by_seller: { seller_id: string; seller_name: string | null; operations: number; lom_differs_from_saved: number; usd_differs_from_saved: number; max_abs_lom_deviation_pct: number | null }[];
};

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("ru-RU"));
const KIND: Record<string, string> = {
  payment_gram: "To'lov (585)", handover: "Topshiruv", payment_uzs: "To'lov (so'm qarz)", payment_usd: "To'lov (USD qarz)",
};

export function OperationRateReview() {
  const [data, setData] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seller, setSeller] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const { data: d, error: e } = await supabase.rpc("rpc_get_operation_rate_review");
    setBusy(false);
    if (e) setError(parseErrorMessage(e));
    else {
      setError(null);
      setData(d as Review);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => (!seller || r.seller_id === seller) && (!onlyDiff || r.lom_differs_from_saved || r.usd_differs_from_saved)),
    [data, seller, onlyDiff],
  );

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3 text-white" data-testid="operation-rate-review">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-amber-400">Operatsiyalarda ishlatilgan kurslar</h2>
        <span className="text-[11px] text-slate-400">
          {data ? `${data.start_date} — ${data.end_date}` : ""} {data?.truncated ? "(oxirgi 2000 ta)" : ""}
        </span>
      </div>
      <p className="text-[11px] text-slate-400">
        Har bir hujjat kiritilgan kurs, kim va qachon kiritgani bilan saqlanadi; eski hujjatlar qayta baholanmaydi. Sariq — saqlangan kursdan farq qiladi.
      </p>
      {error && <div role="alert" className="text-xs text-rose-300">{error}</div>}
      {data && data.by_seller.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono" data-testid="rate-review-summary">
            <thead className="text-slate-500">
              <tr><th className="text-left font-sans">Sotuvchi</th><th className="text-right">Operatsiya</th><th className="text-right">LOM farqli</th><th className="text-right">USD farqli</th><th className="text-right">Rasmiydan maks. %</th></tr>
            </thead>
            <tbody>
              {data.by_seller.map((s) => (
                <tr key={s.seller_id} className="border-t border-slate-800">
                  <td className="py-1 font-sans">{s.seller_name || s.seller_id}</td>
                  <td className="text-right">{s.operations}</td>
                  <td className={`text-right ${s.lom_differs_from_saved ? "text-amber-300" : ""}`}>{s.lom_differs_from_saved}</td>
                  <td className={`text-right ${s.usd_differs_from_saved ? "text-amber-300" : ""}`}>{s.usd_differs_from_saved}</td>
                  <td className="text-right">{s.max_abs_lom_deviation_pct === null ? "—" : `${s.max_abs_lom_deviation_pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select aria-label="Sotuvchi" data-testid="rate-review-seller" value={seller} onChange={(e) => setSeller(e.target.value)}
          className="min-h-[40px] rounded-lg bg-slate-800 border border-slate-700 px-2 text-white">
          <option value="">Barcha sotuvchilar</option>
          {(data?.by_seller ?? []).map((s) => <option key={s.seller_id} value={s.seller_id}>{s.seller_name || s.seller_id}</option>)}
        </select>
        <label className="flex items-center gap-1 min-h-[40px]">
          <input type="checkbox" data-testid="rate-review-only-diff" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          Faqat saqlangan kursdan farqli
        </label>
        <button type="button" onClick={() => void load()} disabled={busy}
          className="min-h-[40px] px-3 rounded-lg bg-slate-800 border border-slate-700 disabled:opacity-50">Yangilash</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono" data-testid="rate-review-table">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left font-sans">Vaqt</th><th className="text-left font-sans">Hujjat</th><th className="text-left font-sans">Sotuvchi</th>
              <th className="text-left font-sans">Kiritgan</th><th className="text-right">Naqd / USD</th>
              <th className="text-right">LOM kursi</th><th className="text-right">Saqlangan</th><th className="text-right">Rasmiy</th>
              <th className="text-right">USD kursi</th><th className="text-right">Saqlangan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className={`border-t border-slate-800 ${r.status !== "confirmed" ? "opacity-50 line-through" : ""}`} data-testid="rate-review-row">
                <td className="py-1 font-sans text-slate-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString("ru-RU")}</td>
                <td className="font-sans whitespace-nowrap">{KIND[r.kind] ?? r.kind} {r.doc_no ?? ""}{r.customer_name ? ` · ${r.customer_name}` : ""}</td>
                <td className="font-sans">{r.seller_name ?? "—"}</td>
                <td className="font-sans">{r.recorded_by_name ?? "—"}{r.recorded_by_role ? ` (${r.recorded_by_role})` : ""}</td>
                <td className="text-right whitespace-nowrap">{fmt(r.cash_uzs)} / {fmt(r.usd)}</td>
                <td className={`text-right ${r.lom_differs_from_saved ? "text-amber-300 font-bold" : ""}`} data-testid="rate-review-lom">
                  {fmt(r.lom_rate)}{r.lom_deviation_from_official_pct !== null ? ` (${r.lom_deviation_from_official_pct > 0 ? "+" : ""}${r.lom_deviation_from_official_pct}%)` : ""}
                </td>
                <td className="text-right text-slate-400">{fmt(r.saved_lom_rate)}</td>
                <td className="text-right text-slate-400">{fmt(r.official_lom_rate)}</td>
                <td className={`text-right ${r.usd_differs_from_saved ? "text-amber-300 font-bold" : ""}`}>{fmt(r.usd_rate)}</td>
                <td className="text-right text-slate-400">{fmt(r.saved_usd_rate)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="py-2 font-sans text-slate-400">{busy ? "Yuklanmoqda…" : "Bu davrda kurs ishlatilgan operatsiya yo'q."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
