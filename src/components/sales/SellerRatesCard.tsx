"use client";

// Goldia Sales — the seller's own LOM (UZS per 585 g) and USD (UZS per USD) rates (migration 072).
// The server validates and stores the rates, keeps the history and applies them to this seller's future
// payments only; recorded payments keep the rate they were made at.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { parseErrorMessage } from "@/lib/error-utils";

type RatesResponse = {
  official_585_rate: number | null;
  limits: { lom_min_uzs: number; lom_max_uzs: number; usd_min_uzs: number; usd_max_uzs: number; max_lom_deviation_pct: number | null };
  sellers: { seller_id: string; seller_name?: string; lom_rate_uzs: number | null; usd_rate_uzs: number | null; updated_at: string | null }[];
  history: { seller_id: string; old_lom_rate_uzs: number | null; new_lom_rate_uzs: number | null; old_usd_rate_uzs: number | null; new_usd_rate_uzs: number | null; reason: string | null; changed_at: string }[];
};

const fmt = (v: number | null | undefined) => (v ? Number(v).toLocaleString("ru-RU") : "—");

export function useSellerRates() {
  const [data, setData] = useState<RatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc("rpc_get_seller_rates");
    if (e) setError(parseErrorMessage(e));
    else {
      setError(null);
      setData(d as RatesResponse);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, reload: load };
}

export function SellerRatesCard({ onChanged }: { onChanged?: () => void }) {
  const { data, error, reload } = useSellerRates();
  const own = data?.sellers?.[0];
  const [lom, setLom] = useState("");
  const [usd, setUsd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const lomN = lom.trim() ? Number(lom) : null;
    const usdN = usd.trim() ? Number(usd) : null;
    if (lomN === null && usdN === null) {
      setMsg({ ok: false, text: "LOM yoki USD kursini kiriting." });
      return;
    }
    if ((lomN !== null && !(Number.isFinite(lomN) && lomN > 0)) || (usdN !== null && !(Number.isFinite(usdN) && usdN > 0))) {
      setMsg({ ok: false, text: "Kurs musbat son bo'lishi kerak." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error: e2 } = await supabase.rpc("rpc_set_my_seller_rates", {
      p_lom_rate_uzs: lomN,
      p_usd_rate_uzs: usdN,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (e2) {
      setMsg({ ok: false, text: parseErrorMessage(e2) });
      return;
    }
    setLom("");
    setUsd("");
    setReason("");
    setMsg({ ok: true, text: "Kurs saqlandi. Faqat bundan keyingi to'lovlaringizga qo'llanadi." });
    await reload();
    onChanged?.();
  };

  return (
    <div className="rounded-2xl bg-slate-900 border border-amber-500/40 p-4 space-y-3 text-white" data-testid="seller-rates-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-amber-400">Mening kurslarim</h2>
        <span className="text-[11px] text-slate-400">Rasmiy 585: {fmt(data?.official_585_rate)} UZS/g</span>
      </div>
      {error && <div role="alert" className="text-xs text-rose-300">{error}</div>}
      <div className="grid grid-cols-2 gap-3 font-mono">
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <div className="text-[11px] text-slate-400 font-sans">LOM (UZS/g)</div>
          <div className="text-lg font-black" data-testid="own-lom-rate">{own?.lom_rate_uzs ? fmt(own.lom_rate_uzs) : "rasmiy kurs"}</div>
        </div>
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <div className="text-[11px] text-slate-400 font-sans">USD (UZS)</div>
          <div className="text-lg font-black" data-testid="own-usd-rate">{own?.usd_rate_uzs ? fmt(own.usd_rate_uzs) : "belgilanmagan"}</div>
        </div>
      </div>

      <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <input inputMode="decimal" value={lom} onChange={(e) => setLom(e.target.value)} placeholder="Yangi LOM kursi" aria-label="Yangi LOM kursi"
          className="rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-white font-mono" />
        <input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="Yangi USD kursi" aria-label="Yangi USD kursi"
          className="rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-white font-mono" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Izoh (ixtiyoriy)" aria-label="Izoh"
          className="rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-white" />
        <button type="submit" disabled={busy} className="sm:col-span-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2.5 disabled:opacity-50">
          {busy ? "Saqlanmoqda…" : "Kursni saqlash"}
        </button>
      </form>
      {msg && <div role="status" className={`text-xs ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</div>}
      {data?.limits && (
        <div className="text-[11px] text-slate-500">
          Ruxsat: LOM {fmt(data.limits.lom_min_uzs)}–{fmt(data.limits.lom_max_uzs)}
          {data.limits.max_lom_deviation_pct ? ` (rasmiydan ±${data.limits.max_lom_deviation_pct}%)` : ""}, USD {fmt(data.limits.usd_min_uzs)}–{fmt(data.limits.usd_max_uzs)}.
          Eski qarzlar va yozilgan to&apos;lovlar qayta hisoblanmaydi.
        </div>
      )}
      {data && data.history.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-300 font-bold">O&apos;zgarishlar tarixi ({data.history.length})</summary>
          <div className="overflow-x-auto mt-2">
            <table className="w-full font-mono text-[11px]">
              <thead className="text-slate-500">
                <tr><th className="text-left">Sana</th><th className="text-right">LOM</th><th className="text-right">USD</th><th className="text-left pl-2">Izoh</th></tr>
              </thead>
              <tbody>
                {data.history.map((h, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td>{new Date(h.changed_at).toLocaleString("ru-RU")}</td>
                    <td className="text-right">{fmt(h.old_lom_rate_uzs)} → {fmt(h.new_lom_rate_uzs)}</td>
                    <td className="text-right">{fmt(h.old_usd_rate_uzs)} → {fmt(h.new_usd_rate_uzs)}</td>
                    <td className="pl-2 font-sans">{h.reason || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}


// Management: every seller's current rates and the latest changes (read only).
export function SellerRatesOverview() {
  const { data, error } = useSellerRates();
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-2 text-white" data-testid="seller-rates-overview">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-amber-400">Sotuvchilar kurslari</h2>
        <span className="text-[11px] text-slate-400">Rasmiy 585: {fmt(data?.official_585_rate)} UZS/g</span>
      </div>
      {error && <div role="alert" className="text-xs text-rose-300">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead className="text-slate-500">
            <tr><th className="text-left font-sans">Sotuvchi</th><th className="text-right">LOM (UZS/g)</th><th className="text-right">USD (UZS)</th><th className="text-right font-sans">Yangilangan</th></tr>
          </thead>
          <tbody>
            {(data?.sellers ?? []).map((r) => (
              <tr key={r.seller_id} className="border-t border-slate-800">
                <td className="py-1.5 font-sans">{r.seller_name || r.seller_id}</td>
                <td className="text-right">{r.lom_rate_uzs ? fmt(r.lom_rate_uzs) : "rasmiy"}</td>
                <td className="text-right">{fmt(r.usd_rate_uzs)}</td>
                <td className="text-right font-sans text-slate-400">{r.updated_at ? new Date(r.updated_at).toLocaleString("ru-RU") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
