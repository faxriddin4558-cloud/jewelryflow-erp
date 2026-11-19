"use client";

// Goldia Sales 091 — "Bozordan LOM xarid qilish": the seller turns part of his till UZS into LOM (an exchange inside
// the till, not a sale and not an expense). Server: rpc_record_seller_lom_purchase / rpc_reverse_seller_lom_purchase.
// The server computes the 585 equivalent (physical x proba / 585), checks the till and books UZS - / LOM + atomically.
// A seller uses his own till; management (manager = director) chooses the seller. One idempotency key per filled form.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";
import { isSellerRole } from "@/lib/sales-payment-rates";

type Purchase = {
  id: string; purchase_no: string; purchase_date: string; seller_id: string; physical_g: number; proba: number; equiv_585_g: number;
  uzs_amount: number; price_per_g_uzs: number; counterparty: string | null; notes: string | null; status: string; reversal_reason: string | null;
};
const newKey = () => `lomx:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now() + ":" + Math.random()}`;
const num = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", "."));

export function SellerLomPurchaseSection({ mode }: { mode: "seller" | "management" }) {
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [sellerId, setSellerId] = useState("");
  const [till, setTill] = useState<{ uzs: number; lp: number; le: number } | null>(null);
  const [rows, setRows] = useState<Purchase[]>([]);
  const [grams, setGrams] = useState("");
  const [proba, setProba] = useState("585");
  const [total, setTotal] = useState("");
  const [price, setPrice] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitKey, setSubmitKey] = useState(newKey);

  useEffect(() => {
    void (async () => {
      if (mode === "seller") {
        const { data } = await supabase.rpc("current_employee_id");
        if (data) setSellerId(String(data));
        return;
      }
      const { data } = await supabase.from("employees").select("id, full_name, name, role").eq("is_active", true);
      setSellers(((data ?? []) as { id: string; full_name?: string | null; name?: string | null; role?: string | null }[])
        .filter((e) => isSellerRole(String(e.role || ""))).map((e) => ({ id: e.id, name: e.full_name || e.name || e.id.slice(0, 8) })));
    })();
  }, [mode]);

  const load = useCallback(async () => {
    if (!sellerId) { setTill(null); setRows([]); return; }
    const [a, p] = await Promise.all([
      supabase.from("seller_gold_accounts").select("seller_till_cash_amount, seller_till_scrap_physical_g, seller_till_scrap_585_eq_g").eq("seller_id", sellerId).maybeSingle(),
      supabase.from("seller_lom_purchases").select("id, purchase_no, purchase_date, seller_id, physical_g, proba, equiv_585_g, uzs_amount, price_per_g_uzs, counterparty, notes, status, reversal_reason")
        .eq("seller_id", sellerId).order("created_at", { ascending: false }).limit(30),
    ]);
    const t = a.data as { seller_till_cash_amount?: number; seller_till_scrap_physical_g?: number; seller_till_scrap_585_eq_g?: number } | null;
    setTill(t ? { uzs: Number(t.seller_till_cash_amount || 0), lp: Number(t.seller_till_scrap_physical_g || 0), le: Number(t.seller_till_scrap_585_eq_g || 0) } : { uzs: 0, lp: 0, le: 0 });
    setRows((p.data ?? []) as Purchase[]);
  }, [sellerId]);
  useEffect(() => { void load(); }, [load]);

  const g = num(grams), pr = num(proba), tot = total ? num(total) : NaN, ppg = price ? num(price) : NaN;
  const eq = g > 0 && pr > 0 ? Math.round((g * pr / 585) * 10000) / 10000 : 0;
  const uzs = Number.isFinite(tot) ? tot : Number.isFinite(ppg) && g > 0 ? Math.round(ppg * g * 100) / 100 : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setNotice(null);
    if (!sellerId) { setError("Sotuvchini tanlang"); return; }
    if (!(g > 0)) { setError("Fizik gramm 0 dan katta bo'lishi kerak"); return; }
    if (!(pr >= 300 && pr <= 1000)) { setError("Proba 300 - 1000 oralig'ida bo'lishi kerak"); return; }
    if (!(uzs > 0)) { setError("Jami UZS yoki 1 g narxini kiriting"); return; }
    if (till && uzs > till.uzs) { setError(`Kassada faqat ${formatScreenUZS(till.uzs)} bor`); return; }
    setBusy(true);
    const { data, error: rpcErr } = await supabase.rpc("rpc_record_seller_lom_purchase", {
      p_physical_g: g, p_proba: pr, p_idempotency_key: submitKey,
      p_uzs_amount: Number.isFinite(tot) ? tot : null, p_price_per_g_uzs: Number.isFinite(ppg) ? ppg : null,
      p_seller_id: mode === "management" ? sellerId : null, p_counterparty: counterparty.trim() || null, p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (rpcErr) { setError(parseErrorMessage(rpcErr, "Lom xaridi saqlanmadi")); return; }
    const d = data as { purchase_no: string; physical_g: number; equiv_585_g: number; uzs_amount: number };
    setNotice(`${d.purchase_no}: ${formatScreenUZS(d.uzs_amount)} → ${formatScreenGrams(d.physical_g, 4)} fizik lom (${formatScreenGrams(d.equiv_585_g, 4)} 585)`);
    setGrams(""); setTotal(""); setPrice(""); setCounterparty(""); setNotes(""); setSubmitKey(newKey());
    void load();
  };

  const reverse = async (row: Purchase) => {
    const why = typeof window !== "undefined" ? window.prompt("Bekor qilish sababi (majburiy):") : null;
    if (!why || !why.trim()) { setError("Bekor qilish sababi kiritilishi shart"); return; }
    setError(null); setNotice(null); setBusy(true);
    const { error: rpcErr } = await supabase.rpc("rpc_reverse_seller_lom_purchase", { p_purchase_id: row.id, p_reason: why.trim(), p_idempotency_key: "lomxr:" + row.id });
    setBusy(false);
    if (rpcErr) { setError(parseErrorMessage(rpcErr, "Bekor qilinmadi")); return; }
    setNotice(`${row.purchase_no} bekor qilindi: UZS kassaga qaytdi, lom kassadan chiqdi`);
    void load();
  };

  const input = "border border-slate-700 bg-slate-950 rounded-lg px-2 py-1.5 text-sm text-slate-100";
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3 text-slate-200" data-testid="seller-lom-purchase">
      <div>
        <div className="text-[11px] uppercase font-bold tracking-wide text-slate-400">🪙 Bozordan LOM xarid qilish</div>
        <p className="text-[11px] text-slate-500 mt-1">
          Kassadagi UZS ning bir qismiga lom olish: UZS kamayadi, lom (fizik va 585) oshadi. Bu savdo ham, xarajat ham emas — mijoz qarzi,
          menejer oldidagi majburiyat, zavod hisobi va foyda o&apos;zgarmaydi. Lom menejerga odatdagi topshirish bilan beriladi.
        </p>
      </div>
      {mode === "management" && (
        <label className="flex flex-col text-xs"><span className="font-bold">Sotuvchi</span>
          <select className={input} value={sellerId} onChange={(e) => setSellerId(e.target.value)} data-testid="lomx-seller">
            <option value="">Tanlang…</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
      )}
      {till && (
        <div className="text-xs font-mono" data-testid="lomx-till">Kassa: {formatScreenUZS(till.uzs)} · lom {formatScreenGrams(till.lp, 4)} fizik / {formatScreenGrams(till.le, 4)} 585</div>
      )}
      <form onSubmit={(e) => void submit(e)} className="grid gap-2 sm:grid-cols-3 text-xs items-end">
        <label className="flex flex-col"><span className="font-bold">Fizik gramm</span><input className={input} inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} data-testid="lomx-grams" /></label>
        <label className="flex flex-col"><span className="font-bold">Proba</span><input className={input} inputMode="decimal" value={proba} onChange={(e) => setProba(e.target.value)} data-testid="lomx-proba" /></label>
        <label className="flex flex-col"><span className="font-bold">Jami UZS</span><input className={input} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} data-testid="lomx-total" /></label>
        <label className="flex flex-col"><span className="font-bold">yoki 1 g narxi (UZS)</span><input className={input} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="lomx-price" /></label>
        <label className="flex flex-col"><span className="font-bold">Kimdan (ixtiyoriy)</span><input className={input} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} /></label>
        <label className="flex flex-col"><span className="font-bold">Izoh</span><input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {g > 0 && pr > 0 && (
          <p className="sm:col-span-3 text-[11px] text-slate-400" data-testid="lomx-preview">
            585 ekvivalent: {formatScreenGrams(eq, 4)}{uzs > 0 ? ` · kassadan: ${formatScreenUZS(uzs)}` : ""} (yakuniy qiymatni server hisoblaydi)
          </p>
        )}
        <button type="submit" disabled={busy || !sellerId} className="sm:col-span-3 px-3 py-2 rounded-lg bg-amber-600 text-white font-bold disabled:opacity-50" data-testid="lomx-submit">
          {busy ? "Saqlanmoqda…" : "Lom xaridini saqlash"}
        </button>
      </form>
      {error && <p className="text-rose-300 text-xs" data-testid="lomx-error">{error}</p>}
      {notice && <p className="text-emerald-300 text-xs" data-testid="lomx-notice">{notice}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-800 text-xs" data-testid="lomx-history">
          {rows.map((r) => (
            <li key={r.id} className={`py-2 flex flex-wrap justify-between gap-2 ${r.status === "reversed" ? "line-through text-slate-500" : ""}`}>
              <span>{r.purchase_no} · {r.purchase_date}{r.counterparty ? ` · ${r.counterparty}` : ""}</span>
              <span className="font-mono">
                {formatScreenUZS(r.uzs_amount)} → {formatScreenGrams(r.physical_g, 4)} ({Number(r.proba)}) = {formatScreenGrams(r.equiv_585_g, 4)} 585
              </span>
              {r.status === "confirmed" && (
                <button type="button" disabled={busy} onClick={() => void reverse(r)} className="text-rose-300 font-bold disabled:opacity-50">Bekor qilish</button>
              )}
              {r.status === "reversed" && r.reversal_reason && <span className="w-full text-[10px]">bekor: {r.reversal_reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
