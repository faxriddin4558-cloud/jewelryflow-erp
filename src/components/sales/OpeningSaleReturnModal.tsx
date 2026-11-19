"use client";

// 089 — "↩️ Eski savdodan vozvrat": goods sold BEFORE the opening (T0) come back. No sale is invented: the return is
// written against the customer's locked opening debt (585 g or UZS / USD). The operator enters the original customer %
// (585) or the original amount (UZS / USD) - nothing is guessed - asks the SERVER for the exact effect. The seller's
// obligation is never entered: kept by the seller, his old documented obligation moves onto the goods (unchanged);
// to the manager, that old obligation leaves him
// (rpc_preview_opening_sale_return), confirms it, and only then records (rpc_record_opening_sale_return).
// One idempotency key per opened dialog + a busy lock: a double click records one return only.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { newIdemKey } from "@/lib/goldia-089-ui";

type OpeningDebt = { id: string; document_no: string; kind: string; unit: string; amount: number; equiv_585_g: number | null };
type Preview = {
  credit: number; debt_reduced: number; advance_created: number; opening_part: number; opening_remaining: number;
  seller_obligation_released_g: number; customer_net_before: number; customer_net_after: number; formula: string;
  opening_document_no: string | null; rated: boolean; new_debt_part?: number; has_opening_document?: boolean; old_obligation_g: number; seller_keep_allowed: boolean;
  seller_keep_refusal: string | null; seller_obligation_change_g: number;
};
export type OpeningReturnResult = { return_no: string; unit: string; credit: number; debt_reduced: number; advance_created: number };

const fmtUnit = (unit: string, v: number) =>
  unit === "G585" ? formatScreenGrams(v, 4) : unit === "USD" ? `$${Number(v).toLocaleString("ru-RU")}` : formatScreenUZS(v);
const toNum = (s: string) => { const x = parseFloat(s.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(x) ? x : NaN; };

export function OpeningSaleReturnModal({ customerId, customerName, onClose, onDone }: {
  customerId: string; customerName: string; onClose: () => void; onDone: (r: OpeningReturnResult) => void;
}) {
  const [debts, setDebts] = useState<OpeningDebt[] | null>(null);
  const [unit, setUnit] = useState("");
  const [weight, setWeight] = useState("");
  const [pct, setPct] = useState("");
  const [amount, setAmount] = useState("");
  const [receiver, setReceiver] = useState<"seller" | "manager">("seller");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => newIdemKey("OSR"));

  useEffect(() => {
    void (async () => {
      const { data, error: e } = await supabase.from("opening_documents")
        .select("id, document_no, kind, unit, amount, equiv_585_g")
        .eq("customer_id", customerId).eq("status", "active").eq("side", "debt").in("kind", ["customer_gram", "customer_currency"]);
      if (e) { setError(parseErrorMessage(e, "Boshlang'ich qarzlar yuklanmadi")); setDebts([]); return; }
      const list = (data ?? []) as OpeningDebt[];
      setDebts(list);
      setUnit(list[0]?.unit ?? "G585"); // 092: a return is possible without an opening debt too (old part 0)
    })();
  }, [customerId]);

  // any change of the inputs invalidates the confirmed numbers
  useEffect(() => { setPreview(null); setConfirmed(false); }, [unit, weight, pct, amount, receiver]);

  const w = toNum(weight);
  const is585 = unit === "G585";
  const inputError = !unit ? "Boshlang'ich qarz tanlanmagan"
    : !(w > 0) ? "Qaytgan vaznni kiriting"
    : is585 && !(toNum(pct) >= 0 && toNum(pct) <= 100) ? "Mijozga sotilgan ASL foizni kiriting (taxmin qilinmaydi)"
    : !is585 && !(toNum(amount) > 0) ? `Qaytgan tovarning ASL ${unit} qiymatini kiriting (kurs bilan hisoblanmaydi)`
    : null;

  const args = () => ({
    p_customer_id: customerId, p_unit: unit, p_weight_grams: w,
    p_customer_markup_pct: is585 ? toNum(pct) : null, p_credit_amount: is585 ? null : toNum(amount),
  });

  const doPreview = async () => {
    if (inputError) { setError(inputError); return; }
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc("rpc_preview_opening_sale_return", { ...args(), p_receiver: receiver });
    setBusy(false);
    if (e) { setError(parseErrorMessage(e, "Hisoblab bo'lmadi")); return; }
    setPreview(data as unknown as Preview);
  };

  const doRecord = async () => {
    if (!preview || !confirmed || busy) return;
    if (!reason.trim()) { setError("Vozvrat sababini kiriting"); return; }
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc("rpc_record_opening_sale_return", {
      ...args(), p_receiver: receiver, p_seller_markup_pct: null,
      p_reason: reason.trim(), p_confirmed: true, p_idempotency_key: idemKey,
    });
    setBusy(false);
    if (e) { setError(parseErrorMessage(e, "Vozvrat saqlanmadi")); return; }
    onDone(data as unknown as OpeningReturnResult);
  };

  const cls = "w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm";
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-amber-800/70 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-3 text-sm" data-testid="opening-return-modal">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-black text-amber-300">↩️ Eski savdodan vozvrat</h3>
            <p className="text-slate-400 text-xs">{customerName} — boshlang&apos;ichdan (T0) oldin sotilgan tovar. Yangi savdo yaratilmaydi; boshlang&apos;ich hujjatlar o&apos;zgarmaydi.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Yopish">×</button>
        </div>

        {debts === null ? <p className="text-slate-400">Yuklanmoqda…</p> : (
          <>
            <label className="block">
              <span className="text-slate-300 font-bold text-xs">Qarz birligi (avval eski qarzdan, keyin yangi qarzdan, qolgani avansga)</span>
              <select className={cls} value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="osr-unit">
                {["G585", "UZS", "USD"].map((u) => {
                  const d = debts.find((x) => x.unit === u);
                  return (
                    <option key={u} value={u}>{u === "G585" ? "585 gramm" : u}{d ? ` — boshlang'ich qarz ${d.document_no}: ${fmtUnit(d.unit, Number(d.amount))}${d.unit !== "G585" && d.equiv_585_g === null ? " (kurssiz)" : ""}` : " — boshlang'ich qarz yo'q"}</option>
                  );
                })}
              </select>
            </label>
            <label className="block">
              <span className="text-slate-300 font-bold text-xs">Qaytgan tovar vazni (g)</span>
              <input className={cls} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} data-testid="osr-weight" />
            </label>
            {is585 ? (
              <label className="block">
                <span className="text-slate-300 font-bold text-xs">Mijozga sotilgan ASL foiz (%) — majburiy</span>
                <input className={cls} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="osr-pct" />
              </label>
            ) : (
              <label className="block">
                <span className="text-slate-300 font-bold text-xs">Qaytgan tovarning ASL qiymati ({unit}) — majburiy</span>
                <input className={cls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="osr-amount" />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setReceiver("seller")}
                className={`rounded-lg border px-2 py-2 font-bold text-xs ${receiver === "seller" ? "border-amber-500 bg-amber-950 text-amber-200" : "border-slate-700 text-slate-400"}`}>
                Sotuvchi javoniga
              </button>
              <button type="button" onClick={() => setReceiver("manager")}
                className={`rounded-lg border px-2 py-2 font-bold text-xs ${receiver === "manager" ? "border-amber-500 bg-amber-950 text-amber-200" : "border-slate-700 text-slate-400"}`}>
                Menejer omboriga
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              {receiver === "seller"
                ? "Sotuvchida qoladi: uning eski majburiyati (hujjatdan) tovarga o'tadi — sotuvchi majburiyati o'zgarmaydi. Foiz kiritilmaydi."
                : "Menejerga: sotuvchining shu qarz bo'yicha eski majburiyati (hujjatdan) kamayadi, menejer ombori oshadi."}
            </p>
            <button type="button" onClick={() => void doPreview()} disabled={busy || Boolean(inputError)}
              className="w-full rounded-lg bg-slate-800 border border-slate-600 py-2 font-bold text-white disabled:opacity-50" data-testid="osr-preview">
              Hisoblash (server)
            </button>
            {inputError && <p className="text-amber-300 text-xs">{inputError}</p>}

            {preview && (
              <div className="rounded-xl border border-amber-700/70 bg-amber-950/30 p-3 space-y-1 text-xs" data-testid="osr-preview-box">
                <div className="text-amber-200 font-bold">{preview.formula}</div>
                <div>Qiymat: <b>{fmtUnit(unit, preview.credit)}</b> → qarzdan <b>{fmtUnit(unit, preview.debt_reduced)}</b>, avansga <b>{fmtUnit(unit, preview.advance_created)}</b></div>
                <div>Mijoz: {fmtUnit(unit, preview.customer_net_before)} → <b>{fmtUnit(unit, preview.customer_net_after)}</b> (manfiy = avans)</div>
                <div data-testid="osr-parts">Eski qarzdan: <b>{fmtUnit(unit, preview.opening_part)}</b>{preview.opening_document_no ? ` (${preview.opening_document_no})` : " (boshlang'ich qarz yo'q)"} · yangi qarzdan: <b>{fmtUnit(unit, Number(preview.new_debt_part ?? preview.debt_reduced - preview.opening_part))}</b> · avansga: <b>{fmtUnit(unit, preview.advance_created)}</b></div>
                <div>Hujjatdagi eski sotuvchi majburiyati: <b>{formatScreenGrams(preview.old_obligation_g, 4)}</b>{!preview.rated && " (kurssiz qarz — majburiyatda bo'lmagan)"}</div>
                <div data-testid="osr-seller-effect">{receiver === "seller"
                  ? `Sotuvchi ombori +${formatScreenGrams(w, 4)}; sotuvchi majburiyati O'ZGARMAYDI (eski ${formatScreenGrams(preview.old_obligation_g, 4)} tovarga o'tadi)`
                  : `Menejer ombori +${formatScreenGrams(w, 4)}; sotuvchi majburiyati ${formatScreenGrams(preview.seller_obligation_change_g, 4)}`}. Zavod hisobi o&apos;zgarmaydi.</div>
                {receiver === "seller" && !preview.seller_keep_allowed && (
                  <div className="text-rose-300 font-bold" data-testid="osr-keep-refused">Sotuvchida qoldirib bo&apos;lmaydi: {preview.seller_keep_refusal}. Menejer omboriga qabul qiling.</div>
                )}
                <label className="flex items-center gap-2 pt-1 text-white font-bold">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="osr-confirm" />
                  Raqamlarni tekshirdim, tasdiqlayman
                </label>
              </div>
            )}
            <label className="block">
              <span className="text-slate-300 font-bold text-xs">Sabab</span>
              <input className={cls} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="osr-reason" />
            </label>
          </>
        )}
        {error && <p className="text-rose-300 text-xs" data-testid="osr-error">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300">Yopish</button>
          <button type="button" onClick={() => void doRecord()} disabled={!preview || !confirmed || busy || !reason.trim() || (receiver === "seller" && !preview.seller_keep_allowed)}
            className="px-4 py-2 rounded-lg bg-amber-600 text-black font-black disabled:opacity-40" data-testid="osr-save">
            {busy ? "Saqlanmoqda…" : "Vozvratni saqlash"}
          </button>
        </div>
      </div>
    </div>
  );
}
