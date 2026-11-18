"use client";

// 089 — a customer payment entered in the wrong currency (e.g. dollars typed as so'm, or a UZS / USD debt paid in the
// 585 gram dialog) is reversed and entered again in ONE server transaction (rpc_correct_client_payment): either both
// happen or nothing - the till and the customer's debt are never written twice. One idempotency key per dialog.

import { useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenUZS } from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { buildCorrectionPayload, newIdemKey } from "@/lib/goldia-089-ui";
import { wholeDollarsInUzs } from "@/lib/payment-hints";

export type CorrectionTarget = {
  tx_id: string; tx_type: string; customer_name: string; model_name?: string | null;
  cash_received_uzs?: number | null; usd_received?: number | null; rate_per_gram?: number | null; usd_rate?: number | null;
};

export function PaymentCorrectionModal({ target, onClose, onDone }: {
  target: CorrectionTarget; onClose: () => void; onDone: (text: string) => void;
}) {
  const oldKind = target.tx_type === "currency_payment" ? "CPAY" : "SETTL";
  const oldCash = Number(target.cash_received_uzs || 0), oldUsd = Number(target.usd_received || 0);
  const oldUsdRate = Number(target.usd_rate || 0);
  const guessDollars = oldUsd === 0 && oldUsdRate > 0 ? wholeDollarsInUzs(oldCash, oldUsdRate) : null;
  const [newKind, setNewKind] = useState<"SETTL" | "CPAY">(oldKind);
  const [currency, setCurrency] = useState<"UZS" | "USD">((target.model_name || "").includes("USD") ? "USD" : "UZS");
  const [cashUzs, setCashUzs] = useState(guessDollars ? "" : String(oldCash || ""));
  const [usdAmount, setUsdAmount] = useState(guessDollars ? String(guessDollars) : String(oldUsd || ""));
  const [lomRate, setLomRate] = useState(target.rate_per_gram ? String(target.rate_per_gram) : "");
  const [usdRate, setUsdRate] = useState(oldUsdRate ? String(oldUsdRate) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => newIdemKey("CORR"));

  const built = buildCorrectionPayload({ newKind, currency, cashUzs, usdAmount, lomRate, usdRate });

  const submit = async () => {
    if (busy) return;
    if (!reason.trim()) { setError("Tuzatish sababini kiriting"); return; }
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc("rpc_correct_client_payment", {
      p_kind: oldKind, p_payment_id: target.tx_id, p_new_kind: newKind, p_new: built.payload,
      p_reason: reason.trim(), p_idempotency_key: idemKey,
    });
    setBusy(false);
    if (e) { setError(parseErrorMessage(e, "Tuzatib bo'lmadi - eski to'lov o'zgarmadi")); return; }
    const r = data as { new_payment_id?: string };
    onDone(`To'lov tuzatildi: eski ${oldKind} bekor qilindi, yangi ${newKind} yozildi (${String(r.new_payment_id || "").slice(0, 8)}).`);
  };

  const cls = "w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm";
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-sky-800/70 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-3 text-sm" data-testid="payment-correction-modal">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-black text-sky-300">💱 To&apos;lov valyutasini tuzatish</h3>
            <p className="text-slate-400 text-xs">{target.customer_name}: eski {oldKind} — {oldCash > 0 ? formatScreenUZS(oldCash) : ""}{oldUsd > 0 ? ` $${oldUsd.toLocaleString("ru-RU")}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Yopish">×</button>
        </div>
        <p className="rounded-lg border border-sky-900 bg-sky-950/40 p-2 text-xs text-sky-200">
          Eski to&apos;lov bekor qilinadi va to&apos;g&apos;ri valyutada qayta yoziladi — <b>bitta amalda</b>. Xato bo&apos;lsa hech narsa o&apos;zgarmaydi; kassa va mijoz qarzi ikki marta yozilmaydi.
        </p>
        {guessDollars && (
          <p className="text-amber-300 text-xs">Eski so&apos;m summasi aniq {guessDollars.toLocaleString("en-US")} USD ga teng — dollar maydoniga ko&apos;chirildi. Tekshiring.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setNewKind("SETTL")}
            className={`rounded-lg border px-2 py-2 font-bold text-xs ${newKind === "SETTL" ? "border-sky-500 bg-sky-950 text-sky-200" : "border-slate-700 text-slate-400"}`}>585 gramm qarzi (SETTL)</button>
          <button type="button" onClick={() => setNewKind("CPAY")}
            className={`rounded-lg border px-2 py-2 font-bold text-xs ${newKind === "CPAY" ? "border-sky-500 bg-sky-950 text-sky-200" : "border-slate-700 text-slate-400"}`}>So&apos;m / dollar qarzi (CPAY)</button>
        </div>
        {newKind === "CPAY" && (
          <label className="block"><span className="text-slate-300 font-bold text-xs">Qaysi qarz yopiladi</span>
            <select className={cls} value={currency} onChange={(e) => setCurrency(e.target.value as "UZS" | "USD")}>
              <option value="UZS">UZS qarzi</option><option value="USD">USD qarzi</option>
            </select>
          </label>
        )}
        <label className="block"><span className="text-slate-300 font-bold text-xs">Mijoz bergan SO&apos;M (UZS)</span>
          <input className={cls} inputMode="numeric" value={cashUzs} onChange={(e) => setCashUzs(e.target.value)} data-testid="corr-uzs" /></label>
        <label className="block"><span className="text-slate-300 font-bold text-xs">Mijoz bergan DOLLAR (USD) — so&apos;mga aylantirmang</span>
          <input className={cls} inputMode="decimal" value={usdAmount} onChange={(e) => setUsdAmount(e.target.value)} data-testid="corr-usd" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-slate-300 font-bold text-xs">585 kurs (so&apos;m/g)</span>
            <input className={cls} inputMode="numeric" value={lomRate} onChange={(e) => setLomRate(e.target.value)} /></label>
          <label className="block"><span className="text-slate-300 font-bold text-xs">USD kurs (so&apos;m/$)</span>
            <input className={cls} inputMode="numeric" value={usdRate} onChange={(e) => setUsdRate(e.target.value)} /></label>
        </div>
        {"error" in built && <p className="text-amber-300 text-xs">{built.error}</p>}
        <label className="block"><span className="text-slate-300 font-bold text-xs">Sabab</span>
          <input className={cls} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="corr-reason" /></label>
        {error && <p className="text-rose-300 text-xs" data-testid="corr-error">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300">Yopish</button>
          <button type="button" onClick={() => void submit()} disabled={busy || "error" in built || !reason.trim()}
            className="px-4 py-2 rounded-lg bg-sky-600 text-black font-black disabled:opacity-40" data-testid="corr-save">
            {busy ? "Saqlanmoqda…" : "Bekor qilib, qayta yozish"}
          </button>
        </div>
      </div>
    </div>
  );
}
