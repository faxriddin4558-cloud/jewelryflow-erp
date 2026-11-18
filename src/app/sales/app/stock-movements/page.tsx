"use client";

// Goldia Sales 089 — stock movements per seller (read only, rpc_get_seller_stock_movements): opening goods, new
// consignments, sales, customer returns, old-sale returns, returns to the manager and cancellations, filtered by seller
// and business date. Differences to the stored stock and possible duplicates are SHOWN; nothing is corrected.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { tashkentBusinessDate } from "@/lib/business-date";
import { formatScreenGrams } from "@/lib/barcode-scanner-engine";
import { STOCK_KIND_LABEL } from "@/lib/goldia-089-ui";
import { isSellerRole } from "@/lib/sales-payment-rates";

type SellerSum = {
  seller_id: string; seller_name: string; opening_g: number; in_g: number; out_g: number; closing_g: number; all_time_g: number;
  stored_stock_g: number | null; held_pieces_g: number; difference_to_stored_g: number; difference_to_pieces_g: number; ok: boolean;
};
type Line = { seller_id: string; date: string; at: string; kind: string; document: string; grams: number };
type Dup = { seller_id: string; kind: string; grams: number; first: string; second: string; at: string };
type Result = { from: string; to: string; sellers: SellerSum[]; lines: Line[]; duplicates: Dup[] };

export default function StockMovementsPage() {
  const today = tashkentBusinessDate(new Date().toISOString());
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [seller, setSeller] = useState<string>("");
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("seller") : null;
    if (q) setSeller(q);
    void (async () => {
      const { data } = await supabase.from("employees").select("id, full_name, name, role").eq("is_active", true);
      const list = ((data ?? []) as { id: string; full_name?: string | null; name?: string | null; role?: string | null }[])
        .filter((e) => isSellerRole(String(e.role || "")))
        .map((e) => ({ id: e.id, name: e.full_name || e.name || e.id.slice(0, 8) }));
      setSellers(list);
    })();
  }, []);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc("rpc_get_seller_stock_movements", { p_seller_id: seller || null, p_from: from || null, p_to: to || null });
    setBusy(false);
    if (e) { setError(parseErrorMessage(e, "Ombor harakatlari yuklanmadi")); setRes(null); return; }
    setRes(data as unknown as Result);
  }, [seller, from, to]);
  useEffect(() => { void load(); }, [load]);

  const nameOf = (id: string) => res?.sellers.find((s) => s.seller_id === id)?.seller_name || sellers.find((s) => s.id === id)?.name || id.slice(0, 8);
  const g = (v: number | null | undefined) => formatScreenGrams(Number(v || 0), 4);

  return (
    <div className="space-y-4 p-3 sm:p-6 text-[#0F172A]">
      <div>
        <h1 className="text-xl font-black">📦 Ombor harakati (sotuvchilar)</h1>
        <p className="text-xs text-slate-500">Faqat ko&apos;rish: farqlar va takrorlar ko&apos;rsatiladi, balanslar avtomatik tuzatilmaydi.</p>
      </div>
      <div className="flex flex-wrap gap-2 items-end text-sm">
        <label className="flex flex-col"><span className="text-xs font-bold">Sotuvchi</span>
          <select className="border rounded-lg px-2 py-1.5" value={seller} onChange={(e) => setSeller(e.target.value)} data-testid="sm-seller">
            <option value="">Hammasi</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col"><span className="text-xs font-bold">Dan</span>
          <input type="date" className="border rounded-lg px-2 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex flex-col"><span className="text-xs font-bold">Gacha</span>
          <input type="date" className="border rounded-lg px-2 py-1.5" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" onClick={() => void load()} disabled={busy} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold disabled:opacity-50">
          {busy ? "Yuklanmoqda…" : "Yangilash"}
        </button>
      </div>
      {error && <p className="text-rose-700 text-sm">{error}</p>}

      {res && (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="min-w-full text-xs" data-testid="sm-summary">
              <thead className="bg-slate-50 text-slate-600">
                <tr><th className="p-2 text-left">Sotuvchi</th><th className="p-2 text-right">Boshida</th><th className="p-2 text-right">Kirim</th>
                  <th className="p-2 text-right">Chiqim</th><th className="p-2 text-right">Oxirida</th><th className="p-2 text-right">Hisobdagi qoldiq</th>
                  <th className="p-2 text-right">Javondagi donalar</th><th className="p-2 text-left">Holat</th></tr>
              </thead>
              <tbody>
                {res.sellers.map((s) => (
                  <tr key={s.seller_id} className="border-t">
                    <td className="p-2 font-bold">{s.seller_name}</td>
                    <td className="p-2 text-right font-mono">{g(s.opening_g)}</td>
                    <td className="p-2 text-right font-mono text-emerald-700">+{g(s.in_g)}</td>
                    <td className="p-2 text-right font-mono text-rose-700">{g(s.out_g)}</td>
                    <td className="p-2 text-right font-mono font-bold">{g(s.closing_g)}</td>
                    <td className="p-2 text-right font-mono">{g(s.stored_stock_g)}</td>
                    <td className="p-2 text-right font-mono">{g(s.held_pieces_g)}</td>
                    <td className="p-2">
                      {s.ok ? <span className="text-emerald-700 font-bold">✓ mos</span>
                        : <span className="text-rose-700 font-bold" data-testid="sm-difference">⚠ farq {g(s.difference_to_stored_g)} (hujjatlar − hisob)</span>}
                      {Math.abs(Number(s.difference_to_pieces_g)) >= 0.0005 && <div className="text-amber-700">donalar bilan farq {g(s.difference_to_pieces_g)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {res.duplicates.length > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs" data-testid="sm-duplicates">
              <div className="font-bold text-amber-800 mb-1">⚠ Ehtimoliy takrorlar (10 daqiqa ichida bir xil vazn) — tekshiring, avtomatik o&apos;zgartirilmaydi</div>
              {res.duplicates.map((d, i) => (
                <div key={i}>{nameOf(d.seller_id)}: {STOCK_KIND_LABEL[d.kind] || d.kind} {g(d.grams)} — {d.first} / {d.second}</div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="min-w-full text-xs" data-testid="sm-lines">
              <thead className="bg-slate-50 text-slate-600">
                <tr><th className="p-2 text-left">Sana</th><th className="p-2 text-left">Sotuvchi</th><th className="p-2 text-left">Harakat</th>
                  <th className="p-2 text-left">Hujjat</th><th className="p-2 text-right">Gramm</th></tr>
              </thead>
              <tbody>
                {res.lines.map((l, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-mono">{l.date}</td>
                    <td className="p-2">{nameOf(l.seller_id)}</td>
                    <td className="p-2">{STOCK_KIND_LABEL[l.kind] || l.kind}</td>
                    <td className="p-2 font-mono">{l.document}</td>
                    <td className={`p-2 text-right font-mono ${Number(l.grams) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{Number(l.grams) >= 0 ? "+" : ""}{g(l.grams)}</td>
                  </tr>
                ))}
                {res.lines.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-500">Bu oraliqda harakat yo&apos;q.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
