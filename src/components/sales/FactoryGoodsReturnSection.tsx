"use client";

// Goldia Sales 090 — manager -> factory goods return (rpc_return_goods_to_factory / rpc_reverse_factory_goods_return).
// Only goods that came on a factory receipt can go back; the factory net goes down by grams x (1 + the receipt's %).
// All values are computed by the server; this screen only sends grams + reason and shows what the server booked.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { formatScreenGrams } from "@/lib/barcode-scanner-engine";

type Receipt = {
  id: string; receipt_no: string | null; receipt_date: string | null; product_name: string | null;
  available_physical_g: number; factory_markup_pct: number | null; opening_document_id: string | null;
};
type GoodsReturn = {
  id: string; created_at: string; grams: number; factory_markup_pct: number; factory_value_g: number;
  reason: string; status: string; reversal_reason: string | null; factory_receipt_id: string;
};

const newKey = (p: string) => `${p}:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now() + ":" + Math.random()}`;
const g = (v: number | null | undefined) => formatScreenGrams(Number(v || 0), 4);

export function FactoryGoodsReturnSection() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [returns, setReturns] = useState<GoodsReturn[]>([]);
  const [receiptId, setReceiptId] = useState("");
  const [grams, setGrams] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitKey, setSubmitKey] = useState(() => newKey("fgr"));

  const load = useCallback(async () => {
    const [r, x] = await Promise.all([
      supabase.from("factory_receipts")
        .select("id, receipt_no, receipt_date, product_name, available_physical_g, factory_markup_pct, opening_document_id")
        .gt("available_physical_g", 0).not("status", "in", "(reversed,cancelled)").order("receipt_date", { ascending: true }),
      supabase.from("factory_goods_returns")
        .select("id, created_at, grams, factory_markup_pct, factory_value_g, reason, status, reversal_reason, factory_receipt_id")
        .order("created_at", { ascending: false }).limit(50),
    ]);
    if (r.error) setError(parseErrorMessage(r.error, "Zavod kirimlari yuklanmadi"));
    setReceipts((r.data ?? []) as Receipt[]);
    setReturns((x.data ?? []) as GoodsReturn[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sel = receipts.find((r) => r.id === receiptId);
  const n = Number(grams.replace(",", "."));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setNotice(null);
    if (!sel) { setError("Zavod kirimini tanlang"); return; }
    if (!(n > 0)) { setError("Gramm 0 dan katta bo'lishi kerak"); return; }
    if (n > Number(sel.available_physical_g)) { setError(`Menejer omborida bu kirimdan faqat ${g(sel.available_physical_g)} g bor`); return; }
    if (!reason.trim()) { setError("Qaytarish sababi kiritilishi shart"); return; }
    setBusy(true);
    const { data, error: rpcErr } = await supabase.rpc("rpc_return_goods_to_factory", {
      p_receipt_id: sel.id, p_grams: n, p_reason: reason.trim(), p_idempotency_key: submitKey,
    });
    setBusy(false);
    if (rpcErr) { setError(parseErrorMessage(rpcErr, "Zavodga qaytarish bajarilmadi")); return; }
    const d = data as { grams: number; factory_value_g: number; factory_markup_pct: number };
    setNotice(`Zavodga qaytarildi: ${g(d.grams)} g, ${d.factory_markup_pct}% bilan zavod hisobidan ${g(d.factory_value_g)} g kamaydi`);
    setGrams(""); setReason(""); setSubmitKey(newKey("fgr"));
    void load();
  };

  const reverse = async (row: GoodsReturn) => {
    const why = typeof window !== "undefined" ? window.prompt("Bekor qilish sababi (majburiy):") : null;
    if (!why || !why.trim()) { setError("Bekor qilish sababi kiritilishi shart"); return; }
    setError(null); setNotice(null); setBusy(true);
    const { error: rpcErr } = await supabase.rpc("rpc_reverse_factory_goods_return", {
      p_return_id: row.id, p_reason: why.trim(), p_idempotency_key: newKey("fgrr:" + row.id),
    });
    setBusy(false);
    if (rpcErr) { setError(parseErrorMessage(rpcErr, "Bekor qilinmadi")); return; }
    setNotice("Zavodga qaytarish bekor qilindi: tovar menejer omboriga, zavod hisobi asl holiga qaytdi");
    void load();
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4 text-[#0F172A]" data-testid="factory-goods-return">
      <div>
        <h2 className="text-lg font-black">↩️ Menejer omboridan zavodga tovar qaytarish</h2>
        <p className="text-xs text-slate-500">
          Faqat zavod kirimi bilan kelgan tovar. Zavod hisobi gramm × (1 + kirim foizi) ga kamayadi; sotuvchi, mijoz qarzi va foyda o&apos;zgarmaydi.
        </p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="grid gap-2 sm:grid-cols-4 items-end text-sm">
        <label className="flex flex-col sm:col-span-2"><span className="text-xs font-bold">Zavod kirimi</span>
          <select className="border rounded-lg px-2 py-1.5" value={receiptId} onChange={(e) => setReceiptId(e.target.value)} data-testid="fgr-receipt">
            <option value="">Tanlang…</option>
            {receipts.map((r) => (
              <option key={r.id} value={r.id}>
                {(r.opening_document_id ? "Boshlang'ich A · " : "") + (r.receipt_no || r.id.slice(0, 8))} · {r.product_name || ""} · omborda {g(r.available_physical_g)} g · {Number(r.factory_markup_pct || 0)}%
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col"><span className="text-xs font-bold">Gramm</span>
          <input inputMode="decimal" className="border rounded-lg px-2 py-1.5" value={grams} onChange={(e) => setGrams(e.target.value)} data-testid="fgr-grams" /></label>
        <label className="flex flex-col"><span className="text-xs font-bold">Sabab</span>
          <input className="border rounded-lg px-2 py-1.5" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="fgr-reason" /></label>
        {sel && n > 0 && (
          <p className="sm:col-span-4 text-xs text-slate-600">
            Taxminiy: zavod hisobidan {g(Math.round(n * (1 + Number(sel.factory_markup_pct || 0) / 100) * 10000) / 10000)} g kamayadi (yakuniy qiymatni server hisoblaydi).
          </p>
        )}
        <button type="submit" disabled={busy} className="sm:col-span-4 px-3 py-2 rounded-lg bg-slate-900 text-white font-bold disabled:opacity-50" data-testid="fgr-submit">
          {busy ? "Bajarilmoqda…" : "Zavodga qaytarish"}
        </button>
      </form>
      {error && <p className="text-rose-700 text-sm" data-testid="fgr-error">{error}</p>}
      {notice && <p className="text-emerald-700 text-sm" data-testid="fgr-notice">{notice}</p>}
      {returns.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th className="p-1">Sana</th><th className="p-1">Gramm</th><th className="p-1">%</th><th className="p-1">Zavod hisobi</th><th className="p-1">Sabab</th><th className="p-1">Holat</th><th /></tr></thead>
            <tbody>
              {returns.map((x) => (
                <tr key={x.id} className="border-t">
                  <td className="p-1">{x.created_at.slice(0, 10)}</td>
                  <td className="p-1">{g(x.grams)}</td>
                  <td className="p-1">{Number(x.factory_markup_pct)}</td>
                  <td className="p-1">−{g(x.factory_value_g)}</td>
                  <td className="p-1">{x.reason}{x.reversal_reason ? ` · bekor: ${x.reversal_reason}` : ""}</td>
                  <td className="p-1">{x.status === "reversed" ? "Bekor qilingan" : "Tasdiqlangan"}</td>
                  <td className="p-1">
                    {x.status === "confirmed" && (
                      <button type="button" disabled={busy} onClick={() => void reverse(x)} className="text-rose-700 font-bold disabled:opacity-50">Bekor qilish</button>
                    )}
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
