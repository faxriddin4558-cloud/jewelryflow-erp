"use client";

// 083 — "↩️ Vozvrat": full or partial customer return of one sale document (server: rpc_record_sale_return).
// The preview uses the ORIGINAL sale (grams x original markup / original UZS-USD amount); the server computes the
// authoritative values (last return = exact remainder) and splits them into debt reduction + advance (no cash refund).
// One idempotency key per opened dialog + a busy lock: a double click / repeated submit records one return only.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";

type SaleInfo = {
  id: string; sale_no: string; sale_type: string; sale_currency: string | null; sale_amount: number | null;
  base_weight_grams: number; client_gold_due_grams: number; client_markup_pct: number; status: string;
};
export type SaleReturnResult = { return_no: string; returned_weight_g: number; returned_value: number; unit: string; debt_reduced: number; advance_created: number };

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function SaleReturnModal({ saleId, customerName, canReceiveAtManager, onClose, onDone }: {
  saleId: string; customerName: string; canReceiveAtManager: boolean;
  onClose: () => void; onDone: (r: SaleReturnResult) => void;
}) {
  const [sale, setSale] = useState<SaleInfo | null>(null);
  const [returned, setReturned] = useState(0);
  const [weight, setWeight] = useState("");
  const [destination, setDestination] = useState<"seller" | "manager">("seller");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(newKey);

  useEffect(() => {
    void (async () => {
      const [s, r] = await Promise.all([
        supabase.from("jewelry_sales").select("id, sale_no, sale_type, sale_currency, sale_amount, base_weight_grams, client_gold_due_grams, client_markup_pct, status").eq("id", saleId).maybeSingle(),
        supabase.from("jewelry_sale_returns").select("returned_weight_grams").eq("sale_id", saleId).eq("status", "confirmed"),
      ]);
      if (s.error || !s.data) { setError(parseErrorMessage(s.error, "Savdo hujjati topilmadi")); return; }
      const info = s.data as SaleInfo;
      const done = r4((r.data ?? []).reduce((a, x) => a + Number(x.returned_weight_grams || 0), 0));
      setSale(info);
      setReturned(done);
      const rest = r4(Number(info.base_weight_grams) - done);
      setWeight(info.sale_type === "piece" ? String(rest) : "");
    })();
  }, [saleId]);

  const remaining = sale ? r4(Number(sale.base_weight_grams) - returned) : 0;
  const w = r4(parseFloat(weight.replace(",", ".")) || 0);
  const cur = sale?.sale_currency ?? "XAU585";
  const preview = useMemo(() => {
    if (!sale || !(w > 0)) return null;
    const share = w / Number(sale.base_weight_grams);
    return cur === "XAU585" ? `${formatScreenGrams(r4(Number(sale.client_gold_due_grams) * share), 4)} (585)`
      : cur === "USD" ? `$${r2(Number(sale.sale_amount) * share).toLocaleString("ru-RU")}` : formatScreenUZS(r2(Number(sale.sale_amount) * share));
  }, [sale, w, cur]);
  const isPiece = sale?.sale_type === "piece";
  const invalid = !sale || !(w > 0) || w > remaining || (isPiece && w !== remaining) || !reason.trim() || remaining <= 0;

  const submit = async () => {
    if (busy || invalid || !sale) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase.rpc("rpc_record_sale_return", {
        p_sale_id: sale.id, p_weight_grams: w, p_reason: reason.trim(), p_destination: destination, p_idempotency_key: idemKey,
      });
      if (e) throw e;
      onDone(data as SaleReturnResult);
    } catch (err: unknown) {
      setError(parseErrorMessage(err, "Vozvratni saqlab bo'lmadi"));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" data-testid="sale-return-modal">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-5 text-slate-200 space-y-3">
        <h3 className="text-base font-black text-amber-300">↩️ Vozvrat — {customerName}</h3>
        {!sale && !error && <div className="text-xs text-slate-400">Yuklanmoqda…</div>}
        {sale && (
          <>
            <div className="text-xs space-y-1 font-mono">
              <div>Savdo: <b>{sale.sale_no}</b> · {formatScreenGrams(sale.base_weight_grams, 4)} · {Number(sale.client_markup_pct)}%</div>
              <div>{cur === "XAU585" ? <>Qiymat: {formatScreenGrams(sale.client_gold_due_grams, 4)} (585)</> : <>Qiymat: {cur} {Number(sale.sale_amount).toLocaleString("ru-RU")}</>}</div>
              <div data-testid="return-remaining">Avval qaytarilgan: {formatScreenGrams(returned, 4)} · qaytarish mumkin: <b>{formatScreenGrams(remaining, 4)}</b></div>
            </div>
            {remaining <= 0 ? (
              <div className="text-xs text-rose-300">Bu savdo to&apos;liq qaytarilgan.</div>
            ) : (
              <>
                <label className="block text-xs">Qaytgan fizik vazn (g){isPiece ? " — barcode dona faqat butun" : ""}
                  <input data-testid="return-weight" inputMode="decimal" value={weight} disabled={isPiece} onChange={(e) => setWeight(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 font-mono" />
                </label>
                {canReceiveAtManager && (
                  <label className="block text-xs">Qabul qiluvchi
                    <select data-testid="return-destination" value={destination} onChange={(e) => setDestination(e.target.value as "seller" | "manager")}
                      className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2">
                      <option value="seller">Sotuvchi ombori (sotuvchi javoniga qaytadi)</option>
                      <option value="manager">Menejer qabul qiladi (menejer omboriga)</option>
                    </select>
                  </label>
                )}
                <label className="block text-xs">Sabab (audit uchun)
                  <input data-testid="return-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2" />
                </label>
                <div className="text-[11px] text-slate-400" data-testid="return-preview">
                  {preview ? <>Mijoz hisobidan kamayadi: <b className="text-emerald-300">{preview}</b>. Ochiq qarzdan oshgan qismi mijoz foydasiga avans bo&apos;ladi (naqd pul qaytarilmaydi). Asl savdo hujjati o&apos;zgarmaydi.</> : "Vaznni kiriting"}
                  {w > remaining && <div className="text-rose-300">Qaytarish mumkin bo&apos;lgan vazndan oshadi</div>}
                </div>
              </>
            )}
          </>
        )}
        {error && <div className="text-xs text-rose-300" data-testid="return-error">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs">Yopish</button>
          <button type="button" data-testid="return-submit" onClick={submit} disabled={busy || invalid}
            className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs disabled:opacity-40">
            {busy ? "Saqlanmoqda…" : "Vozvratni tasdiqlash"}
          </button>
        </div>
      </div>
    </div>
  );
}
