"use client";

// 089 — "Kassa sanog'i": the manager counts the cash a seller really holds and compares it with the till the seller
// must hand over (the till already is the seller's obligation). Only a record: the till, the obligation and the
// customer debts do not change and no second debt is created. A shortage needs its reason (personal use / shortage).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenUZS } from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { newIdemKey, tillCountDiff } from "@/lib/goldia-089-ui";

type CountRow = { id: string; created_at: string; counted_uzs: number; counted_usd: number; diff_uzs: number; diff_usd: number; explanation: string; notes: string | null };
const EXPL: Record<string, string> = { match: "To'g'ri", personal_use: "Shaxsiy ishlatilgan", shortage: "Yetishmovchilik", surplus: "Ortiqcha" };

export function SellerTillCountModal({ sellerId, sellerName, tillUzs, tillUsd, onClose, onDone }: {
  sellerId: string; sellerName: string; tillUzs: number; tillUsd: number; onClose: () => void; onDone: (text: string) => void;
}) {
  const [counted, setCounted] = useState({ uzs: "", usd: "" });
  const [explanation, setExplanation] = useState<"personal_use" | "shortage">("personal_use");
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<CountRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => newIdemKey("TILL"));

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("seller_till_counts")
        .select("id, created_at, counted_uzs, counted_usd, diff_uzs, diff_usd, explanation, notes")
        .eq("seller_id", sellerId).order("created_at", { ascending: false }).limit(5);
      setHistory((data ?? []) as CountRow[]);
    })();
  }, [sellerId]);

  const d = tillCountDiff(tillUzs, tillUsd, counted.uzs.replace(/\s/g, "") || "x", counted.usd.replace(/\s/g, "") || "0");
  const submit = async () => {
    if (!d || busy) return;
    if (d.kind !== "match" && !notes.trim()) { setError("Farq bor: izoh kiriting"); return; }
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc("rpc_record_seller_till_count", {
      p_seller_id: sellerId, p_counted_uzs: Number(counted.uzs.replace(/\s/g, "")), p_counted_usd: Number(counted.usd.replace(/\s/g, "") || 0),
      p_explanation: d.kind === "short" ? explanation : null, p_notes: notes.trim() || null, p_idempotency_key: idemKey,
    });
    setBusy(false);
    if (e) { setError(parseErrorMessage(e, "Sanoq saqlanmadi")); return; }
    const r = data as { diff_uzs: number; diff_usd: number; explanation: string };
    onDone(`Kassa sanog'i saqlandi (${sellerName}): farq ${formatScreenUZS(r.diff_uzs)}, $${Number(r.diff_usd).toLocaleString("ru-RU")} — ${EXPL[r.explanation] || r.explanation}. Kassa va majburiyat o'zgarmadi.`);
  };

  const cls = "w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm";
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto p-5 space-y-3 text-sm text-slate-900" data-testid="till-count-modal">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-black">🧮 Kassa sanog&apos;i — {sellerName}</h3>
            <p className="text-xs text-slate-500">Topshirilishi kerak: <b>{formatScreenUZS(tillUzs)}</b> va <b>${Number(tillUsd).toLocaleString("ru-RU")}</b>. Bu faqat qayd: kassa va majburiyat o&apos;zgarmaydi, yangi qarz yaratilmaydi.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900 text-xl leading-none" aria-label="Yopish">×</button>
        </div>
        <label className="block"><span className="font-bold text-xs">Sotuvchida haqiqatda bor SO&apos;M</span>
          <input className={cls} inputMode="numeric" value={counted.uzs} onChange={(e) => setCounted({ ...counted, uzs: e.target.value })} data-testid="till-uzs" /></label>
        <label className="block"><span className="font-bold text-xs">Sotuvchida haqiqatda bor DOLLAR</span>
          <input className={cls} inputMode="decimal" value={counted.usd} onChange={(e) => setCounted({ ...counted, usd: e.target.value })} data-testid="till-usd" /></label>
        {d && (
          <div className={`rounded-lg p-2 text-xs font-bold ${d.kind === "match" ? "bg-emerald-50 text-emerald-800" : d.kind === "short" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"}`} data-testid="till-diff">
            Farq: {formatScreenUZS(d.diffUzs)} va ${d.diffUsd.toLocaleString("ru-RU")} — {d.kind === "match" ? "kassa to'g'ri" : d.kind === "short" ? "kam (topshirilishi kerak bo'lgan pul qo'lda yo'q)" : "ortiqcha"}
          </div>
        )}
        {d?.kind === "short" && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setExplanation("personal_use")} className={`rounded-lg border px-2 py-2 text-xs font-bold ${explanation === "personal_use" ? "border-rose-500 bg-rose-50" : "border-slate-300"}`}>Shaxsiy ishlatilgan</button>
            <button type="button" onClick={() => setExplanation("shortage")} className={`rounded-lg border px-2 py-2 text-xs font-bold ${explanation === "shortage" ? "border-rose-500 bg-rose-50" : "border-slate-300"}`}>Yetishmovchilik</button>
          </div>
        )}
        <label className="block"><span className="font-bold text-xs">Izoh {d && d.kind !== "match" ? "(majburiy)" : ""}</span>
          <input className={cls} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="till-notes" /></label>
        {error && <p className="text-rose-700 text-xs">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300">Yopish</button>
          <button type="button" onClick={() => void submit()} disabled={!d || busy} className="px-4 py-2 rounded-lg bg-slate-900 text-white font-bold disabled:opacity-40" data-testid="till-save">
            {busy ? "Saqlanmoqda…" : "Sanoqni saqlash"}
          </button>
        </div>
        {history.length > 0 && (
          <div className="border-t pt-2">
            <div className="text-xs font-bold text-slate-500 mb-1">Oxirgi sanoqlar</div>
            {history.map((h) => (
              <div key={h.id} className="text-xs flex justify-between gap-2 py-0.5">
                <span className="text-slate-500">{h.created_at.slice(0, 16).replace("T", " ")}</span>
                <span>{formatScreenUZS(h.diff_uzs)} · ${Number(h.diff_usd).toLocaleString("ru-RU")}</span>
                <span className="font-bold">{EXPL[h.explanation] || h.explanation}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
