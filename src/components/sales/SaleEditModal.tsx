"use client";

// 090 — "✏️ Tahrirlash": correct a sale's grams / % (weight sale), piece / % (piece sale) or price / grams (UZS / USD
// sale). Server: rpc_edit_client_sale — the original is reversed and the corrected sale recorded in ONE transaction
// (customer debt, stock, seller account, report recomputed by the existing operations); old -> new kept in the audit.
// A seller may edit only his own, self-recorded sale with no payment after it in an open period (the server decides).
// One idempotency key per opened dialog + a busy lock: a double click records one edit only.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenGrams } from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";

type SaleInfo = {
  id: string; sale_no: string; sale_type: string | null; sale_currency: string | null; sale_amount: number | null; seller_id: string;
  base_weight_grams: number; client_gold_due_grams: number; client_markup_pct: number; status: string; model_code: string | null;
};
type Piece = { id: string; model_code: string | null; model_name: string | null; weight_grams: number };
export type SaleEditResult = { original_sale_no: string; new_sale_no: string; old: Record<string, unknown>; new: Record<string, unknown> };

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const num = (s: string) => Number(String(s).replace(",", "."));

export function SaleEditModal({ saleId, customerName, onClose, onDone }: {
  saleId: string; customerName: string; onClose: () => void; onDone: (r: SaleEditResult) => void;
}) {
  const [sale, setSale] = useState<SaleInfo | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [currentPiece, setCurrentPiece] = useState<Piece | null>(null);
  const [weight, setWeight] = useState("");
  const [pct, setPct] = useState("");
  const [amount, setAmount] = useState("");
  const [pieceId, setPieceId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => "edit:" + newKey());

  useEffect(() => {
    void (async () => {
      const { data, error: e } = await supabase.from("jewelry_sales")
        .select("id, sale_no, sale_type, sale_currency, sale_amount, seller_id, base_weight_grams, client_gold_due_grams, client_markup_pct, status, model_code")
        .eq("id", saleId).maybeSingle();
      if (e || !data) { setError(parseErrorMessage(e, "Savdo topilmadi")); return; }
      const s = data as SaleInfo;
      setSale(s);
      setWeight(String(Number(s.base_weight_grams)));
      setPct(String(Number(s.client_markup_pct)));
      setAmount(s.sale_amount != null ? String(Number(s.sale_amount)) : "");
      if (s.sale_type === "piece") {
        const [cur, avail] = await Promise.all([
          supabase.from("consignment_pieces").select("id, model_code, model_name, weight_grams").eq("sale_id", saleId).maybeSingle(),
          supabase.from("consignment_pieces").select("id, model_code, model_name, weight_grams").eq("seller_id", s.seller_id).eq("status", "held_by_seller").is("sale_id", null).order("model_code"),
        ]);
        if (cur.data) { setCurrentPiece(cur.data as Piece); setPieceId((cur.data as Piece).id); }
        setPieces((avail.data ?? []) as Piece[]);
      }
    })();
  }, [saleId]);

  const cur = sale?.sale_currency || "XAU585";
  const kind = !sale ? null : cur !== "XAU585" ? "currency" : sale.sale_type === "piece" ? "piece" : "weight";

  const submit = async () => {
    if (!sale || busy) return;
    setError(null);
    if (!reason.trim()) { setError("Tahrirlash sababini kiriting"); return; }
    const args: Record<string, unknown> = { p_sale_id: sale.id, p_reason: reason.trim(), p_idempotency_key: idemKey };
    if (kind === "weight" || kind === "currency") {
      const w = num(weight);
      if (!(w > 0)) { setError("Vazn 0 dan katta bo'lishi kerak"); return; }
      if (w !== Number(sale.base_weight_grams)) args.p_weight_grams = w;
    }
    if (kind === "weight" || kind === "piece") {
      const p = num(pct);
      if (!(p >= 0 && p <= 100)) { setError("Foiz 0 dan 100 gacha bo'lishi kerak"); return; }
      if (p !== Number(sale.client_markup_pct)) args.p_client_markup_pct = p;
    }
    if (kind === "currency") {
      const a = num(amount);
      if (!(a > 0)) { setError("Narx 0 dan katta bo'lishi kerak"); return; }
      if (a !== Number(sale.sale_amount)) args.p_sale_amount = a;
    }
    if (kind === "piece" && pieceId && pieceId !== currentPiece?.id) args.p_piece_id = pieceId;
    if (Object.keys(args).length === 3) { setError("Hech narsa o'zgarmadi"); return; }
    setBusy(true);
    const { data, error: e } = await supabase.rpc("rpc_edit_client_sale", args);
    if (e) { setError(parseErrorMessage(e, "Savdoni tahrirlab bo'lmadi")); setBusy(false); return; }
    onDone(data as unknown as SaleEditResult);
  };

  const input = "w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" data-testid="sale-edit-modal">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-5 text-slate-200 space-y-3">
        <h3 className="text-base font-black text-sky-300">✏️ Savdoni tahrirlash — {customerName}</h3>
        {!sale && !error && <div className="text-xs text-slate-400">Yuklanmoqda…</div>}
        {sale && (
          <>
            <div className="text-xs space-y-1 font-mono">
              <div>Savdo: <b>{sale.sale_no}</b> · {formatScreenGrams(sale.base_weight_grams, 4)} · {kind === "currency" ? `${cur} ${Number(sale.sale_amount).toLocaleString("ru-RU")}` : `${Number(sale.client_markup_pct)}%`}</div>
              {kind === "piece" && currentPiece && <div>Dona: {currentPiece.model_code || currentPiece.model_name} · {formatScreenGrams(currentPiece.weight_grams, 4)}</div>}
            </div>
            <div className="grid gap-2 text-xs">
              {(kind === "weight" || kind === "currency") && (
                <label className="space-y-1"><span className="font-bold">Vazn (g)</span>
                  <input className={input} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} data-testid="edit-weight" /></label>
              )}
              {(kind === "weight" || kind === "piece") && (
                <label className="space-y-1"><span className="font-bold">Mijoz foizi (%)</span>
                  <input className={input} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="edit-pct" /></label>
              )}
              {kind === "currency" && (
                <label className="space-y-1"><span className="font-bold">Narx ({cur})</span>
                  <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="edit-amount" /></label>
              )}
              {kind === "piece" && (
                <label className="space-y-1"><span className="font-bold">Mahsulot (dona)</span>
                  <select className={input} value={pieceId} onChange={(e) => setPieceId(e.target.value)} data-testid="edit-piece">
                    {currentPiece && <option value={currentPiece.id}>{(currentPiece.model_code || currentPiece.model_name || "dona") + " · " + formatScreenGrams(currentPiece.weight_grams, 4)} (hozirgi)</option>}
                    {pieces.map((p) => <option key={p.id} value={p.id}>{(p.model_code || p.model_name || "dona") + " · " + formatScreenGrams(p.weight_grams, 4)}</option>)}
                  </select></label>
              )}
              <label className="space-y-1"><span className="font-bold">Sabab (majburiy)</span>
                <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="edit-reason" /></label>
            </div>
            <div className="text-[11px] text-slate-400">
              Asl savdo tarixda &quot;bekor qilingan&quot; bo&apos;lib qoladi, to&apos;g&apos;rilangan savdo yangi hujjat bo&apos;lib yoziladi; mijoz qarzi,
              ombor va sotuvchi hisobi server tomonidan qayta hisoblanadi. To&apos;lov tushgan, vozvrat qilingan yoki yopilgan davrdagi savdoni
              sotuvchi tahrirlay olmaydi.
            </div>
          </>
        )}
        {error && <div className="text-xs text-rose-300" data-testid="edit-error">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs">Yopish</button>
          <button type="button" onClick={() => void submit()} disabled={busy || !sale} className="px-3 py-1.5 rounded-lg bg-sky-700 text-white text-xs font-bold disabled:opacity-50" data-testid="edit-submit">
            {busy ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </div>
    </div>
  );
}
