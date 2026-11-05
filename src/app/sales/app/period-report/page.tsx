"use client";

// Goldia Sales — period report for any two Asia/Tashkent business dates (both inclusive), 077.
// Read-only except "Yangi davrni boshlash", which only stores a frozen copy of the report: no balance is reset.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { tashkentBusinessDate } from "@/lib/business-date";

type Json = Record<string, unknown>;
type Report = {
  from: string; to: string; today: string;
  opening: Record<string, number>; closing: Record<string, number>; undocumented_opening: Record<string, number | string | null>;
  live: Record<string, number | null>; flows: Record<string, Record<string, number | null>>;
  rates: Record<string, number | null>; sellers: Json[]; profit_policy: string;
};

const BALANCES: [string, string, "g" | "uzs" | "usd"][] = [
  ["customer_debt_net_g585", "Mijozlar qarzi (585 g, avans ayirilgan)", "g"],
  ["customer_debt_net_uzs", "Mijozlar qarzi (UZS savdolar)", "uzs"],
  ["customer_debt_net_usd", "Mijozlar qarzi (USD savdolar)", "usd"],
  ["seller_stock_physical_g", "Sotuvchilardagi oltin (fizik g)", "g"],
  ["seller_till_uzs", "Sotuvchilar kassasi UZS", "uzs"],
  ["seller_till_usd", "Sotuvchilar kassasi USD", "usd"],
  ["seller_till_scrap_g585", "Sotuvchilar kassasi LOM (585 g)", "g"],
  ["manager_cash_uzs", "Menejer kassasi UZS", "uzs"],
  ["manager_cash_usd", "Menejer kassasi USD", "usd"],
  ["factory_obligation_net_g585", "Zavod majburiyati (585 g)", "g"],
];
const KIND_LABEL: Record<string, string> = {
  factory_receipt: "Zavoddan kirim", reversal_factory_receipt: "Zavod kirimi bekor qilindi",
  consignment: "Sotuvchilarga tarqatildi", consignment_cancelled: "Tarqatish bekor qilindi", return_to_manager: "Sotuvchilardan qaytdi",
  sale_gram: "Savdo: gramm + %", sale_uzs: "Savdo: aniq UZS narxda", sale_usd: "Savdo: aniq USD narxda", reversal_sale: "Savdo bekor qilindi / qaytarildi",
  payment_gram: "To'lov: 585 qarzga (naqd / USD / lom)", reversal_payment_gram: "To'lov bekor qilindi (585)",
  payment_uzs: "To'lov: UZS qarzga", payment_usd: "To'lov: USD qarzga", reversal_payment_uzs: "To'lov bekor qilindi (UZS)", reversal_payment_usd: "To'lov bekor qilindi (USD)",
  handover: "Sotuvchidan menejerga topshiruv", reversal_handover: "Topshiruv bekor qilindi",
  factory_handover: "Zavodga topshirildi", reversal_factory_handover: "Zavodga topshiruv bekor qilindi",
  purchase: "Naqdga oltin xarid", reversal_purchase: "Xarid bekor qilindi", fin_reclassify: "Kapital qayta tasniflandi", reversal_fin: "Moliyaviy operatsiya bekor qilindi",
  reversal_legacy: "Eski qarz yozuvi bekor qilindi",
};
const kindLabel = (k: string) => {
  if (KIND_LABEL[k]) return KIND_LABEL[k];
  if (k.startsWith("legacy_")) {
    const [, ...rest] = k.split("_");
    const s = rest.join("_");
    if (s.startsWith("reconciliation_adjustment")) return "Eski qarz: qayta solishtirish";
    if (s.endsWith("_advance")) return "Eski avans kiritildi";
    return "Eski qarz qo'shildi";
  }
  if (k.startsWith("fin_capital_contribution") || k.startsWith("fin_capital_in")) return `Kapital kiritildi (${k.split("_").slice(-2).join("_")})`;
  if (k.startsWith("fin_capital_distribution") || k.startsWith("fin_capital_out")) return `Kapital chiqarildi (${k.split("_").slice(-2).join("_")})`;
  if (k.startsWith("fin_business_expense") || k.startsWith("fin_expense")) return `Xarajat (${k.split("_").slice(-2).join("_")})`;
  return k;
};
const fmt = (v: unknown, unit: "g" | "uzs" | "usd") => {
  const n = Number(v ?? 0);
  if (unit === "g") return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} g`;
  if (unit === "usd") return `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} so'm`;
};
const firstOfMonth = (d: string) => `${d.slice(0, 8)}01`;

function toCsv(rep: Report): string {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows: string[] = [["bo'lim", "ko'rsatkich", "birlik", "davr boshi", "davr oxiri / qiymat"].map(q).join(",")];
  for (const [k, label, unit] of BALANCES) rows.push(["qoldiq", label, unit, rep.opening[k], rep.closing[k]].map(q).join(","));
  for (const [k, v] of Object.entries(rep.flows)) {
    for (const [f, val] of Object.entries(v)) if (val !== null && Number(val) !== 0) rows.push(["harakat", `${kindLabel(k)} — ${f}`, f, "", val].map(q).join(","));
  }
  for (const s of rep.sellers) for (const [f, val] of Object.entries(s)) if (f !== "seller_id") rows.push(["sotuvchi", `${s.name} — ${f}`, "", "", val].map(q).join(","));
  for (const [f, val] of Object.entries(rep.rates ?? {})) rows.push(["kurs", f, "", "", val].map(q).join(","));
  return "﻿" + rows.join("\r\n");
}

export default function PeriodReportPage() {
  const today = tashkentBusinessDate();
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);
  const [sellerId, setSellerId] = useState("");
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [rep, setRep] = useState<Report | null>(null);
  const [periods, setPeriods] = useState<{ id: string; period_start: string; period_end: string; closed_at: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("rpc_get_period_report", { p_from: from, p_to: to, p_seller_id: sellerId || null });
    if (error) setMsg({ ok: false, text: parseErrorMessage(error) });
    else setRep(data as Report);
    const p = await supabase.from("goldia_report_periods").select("id, period_start, period_end, closed_at").order("period_end", { ascending: false }).limit(24);
    if (!p.error) setPeriods(p.data ?? []);
    setBusy(false);
  }, [from, to, sellerId]);

  useEffect(() => {
    void (async () => {
      // role is an enum: filter in the browser (an unknown enum literal in the query is a 400)
      const { data } = await supabase.from("employees").select("id, name, full_name, role, role_type").order("name");
      setSellers((data ?? [])
        .filter((e: Json) => ["sales", "seller", "sotuvchi"].includes(String(e.role || "").toLowerCase()) || String(e.role_type || "").toLowerCase() === "seller")
        .map((e: Json) => ({ id: String(e.id), name: String(e.full_name || e.name || e.id) })));
    })();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closePeriod = async () => {
    if (!window.confirm(`${to} sanasigacha bo'lgan davr yopiladi va hisobot nusxasi saqlanadi. Qarzlar, ombor, kassa va tranzaksiyalar O'ZGARMAYDI. Davom etasizmi?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("rpc_close_report_period", { p_end: to, p_start: from, p_notes: null });
    setBusy(false);
    await load();
    if (error) setMsg({ ok: false, text: parseErrorMessage(error) });
    else setMsg({ ok: true, text: data?.already_closed ? "Bu davr avval yopilgan." : `Davr ${data.period_start} — ${data.period_end} saqlandi. Keyingi davr ${data.next_period_start} dan boshlanadi. Qoldiqlar o'zgarmadi.` });
  };

  const openStored = async (id: string) => {
    const { data, error } = await supabase.from("goldia_report_periods").select("report").eq("id", id).maybeSingle();
    if (error || !data) setMsg({ ok: false, text: error ? parseErrorMessage(error) : "Topilmadi" });
    else {
      const r = data.report as Report;
      setRep(r);
      setFrom(r.from);
      setTo(r.to);
      setMsg({ ok: true, text: `Saqlangan davr hisoboti (${r.from} — ${r.to}) ko'rsatilmoqda.` });
    }
  };

  const download = () => {
    if (!rep) return;
    const blob = new Blob([toCsv(rep)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `goldia-hisobot-${rep.from}-${rep.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const undocumented = useMemo(() => (rep ? BALANCES.filter(([k]) => Math.abs(Number(rep.undocumented_opening?.[k] ?? 0)) > 0.00005) : []), [rep]);

  return (
    <div className="space-y-4 text-white" data-testid="period-report">
      <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-3">
        <h1 className="text-lg font-black">🗓️ Davriy hisobot</h1>
        <p className="text-[11px] text-slate-400">Sanalar Toshkent vaqti bo&apos;yicha, ikkala chekka sana ham kiradi. Har bir hujjat o&apos;z kursi bilan; fizik gramm, 585 gramm, so&apos;m va dollar alohida.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <label className="space-y-1"><span className="text-slate-400">Boshlanish</span>
            <input data-testid="report-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2" /></label>
          <label className="space-y-1"><span className="text-slate-400">Tugash</span>
            <input data-testid="report-to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2" /></label>
          <label className="space-y-1 col-span-2 sm:col-span-1"><span className="text-slate-400">Sotuvchi</span>
            <select data-testid="report-seller" value={sellerId} onChange={(e) => setSellerId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2">
              <option value="">Barchasi</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <div className="flex items-end gap-2 col-span-2 sm:col-span-1">
            <button data-testid="report-load" type="button" disabled={busy} onClick={() => void load()} className="flex-1 px-3 py-2 rounded-xl bg-amber-500 text-slate-950 font-black disabled:opacity-50">Ko&apos;rsatish</button>
            <button data-testid="report-csv" type="button" disabled={!rep} onClick={download} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 font-bold">CSV</button>
          </div>
        </div>
        {msg && <div data-testid="report-msg" className={`text-xs p-2 rounded-xl ${msg.ok ? "bg-emerald-950/60 text-emerald-200" : "bg-rose-950/60 text-rose-200"}`}>{msg.text}</div>}
      </div>

      {rep && (
        <>
          <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
            <h2 className="font-bold text-sm mb-2">Qoldiqlar: {rep.from} boshi → {rep.to} oxiri</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="report-balances">
                <thead><tr className="text-slate-400 text-left"><th className="py-1 pr-2">Ko&apos;rsatkich</th><th className="py-1 pr-2">Davr boshi</th><th className="py-1">Davr oxiri</th></tr></thead>
                <tbody>
                  {BALANCES.map(([k, label, unit]) => (
                    <tr key={k} className="border-t border-slate-800"><td className="py-1 pr-2">{label}</td>
                      <td className="py-1 pr-2 font-mono" data-testid={`open-${k}`}>{fmt(rep.opening[k], unit)}</td>
                      <td className="py-1 font-mono" data-testid={`close-${k}`}>{fmt(rep.closing[k], unit)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {undocumented.length > 0 && (
              <p className="text-[11px] text-amber-300 mt-2">ℹ️ Hujjatsiz boshlang&apos;ich qoldiq (dastlabki kiritish / import): {undocumented.map(([k, l, u]) => `${l}: ${fmt(rep.undocumented_opening[k], u)}`).join("; ")}. U har bir sanadagi qoldiqqa kiradi.</p>
            )}
            <p className="text-[11px] text-slate-400 mt-2">Joriy (hozirgi) holat: menejer ombori {fmt(rep.live.manager_physical_stock_g, "g")}, menejer LOM {fmt(rep.live.manager_scrap_g585, "g")}, sotuvchilar majburiyati {fmt(rep.live.seller_obligation_owes_g585, "g")}.</p>
          </div>

          <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
            <h2 className="font-bold text-sm mb-2">Davr harakatlari</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="report-flows">
                <thead><tr className="text-slate-400 text-left"><th className="py-1 pr-2">Operatsiya</th><th className="py-1 pr-2">Soni</th><th className="py-1 pr-2">Fizik g</th><th className="py-1 pr-2">585 g</th><th className="py-1 pr-2">Summa</th><th className="py-1 pr-2">Naqd so&apos;m</th><th className="py-1 pr-2">USD</th><th className="py-1">LOM 585 g</th></tr></thead>
                <tbody>
                  {Object.entries(rep.flows).sort(([a], [b]) => a.localeCompare(b)).map(([k, f]) => (
                    <tr key={k} className="border-t border-slate-800" data-testid={`flow-${k}`}>
                      <td className="py-1 pr-2">{kindLabel(k)}</td><td className="py-1 pr-2 font-mono">{f.count}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(f.physical_g, "g")}</td><td className="py-1 pr-2 font-mono">{fmt(f.g585, "g")}</td>
                      <td className="py-1 pr-2 font-mono">{k.endsWith("_usd") || k.includes("payment_usd") ? fmt(f.amount, "usd") : Number(f.amount || 0) ? fmt(f.amount, "uzs") : "—"}</td>
                      <td className="py-1 pr-2 font-mono">{f.cash_uzs ? fmt(f.cash_uzs, "uzs") : "—"}</td><td className="py-1 pr-2 font-mono">{f.usd ? fmt(f.usd, "usd") : "—"}</td>
                      <td className="py-1 font-mono">{f.scrap_585_g ? fmt(f.scrap_585_g, "g") : "—"}</td>
                    </tr>
                  ))}
                  {Object.keys(rep.flows).length === 0 && <tr><td colSpan={8} className="py-3 text-center text-slate-400">Bu davrda operatsiya yo&apos;q</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Kurslar (har hujjat o&apos;z kursi): LOM {String(rep.rates?.gram_payments_lom_rate_min ?? "—")}–{String(rep.rates?.gram_payments_lom_rate_max ?? "—")} so&apos;m/g, USD {String(rep.rates?.gram_payments_usd_rate_min ?? "—")}–{String(rep.rates?.gram_payments_usd_rate_max ?? "—")} so&apos;m. Lom: 585 {fmt(rep.rates?.scrap_physical_g_585, "g")}, 750 {fmt(rep.rates?.scrap_physical_g_750, "g")}.</p>
            <p className="text-[11px] text-amber-300 mt-1">{rep.profit_policy}</p>
          </div>

          <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
            <h2 className="font-bold text-sm mb-2">Sotuvchilar kesimida</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="report-sellers">
                <thead><tr className="text-slate-400 text-left"><th className="py-1 pr-2">Sotuvchi</th><th className="py-1 pr-2">Gramm savdo</th><th className="py-1 pr-2">UZS savdo</th><th className="py-1 pr-2">USD savdo</th><th className="py-1 pr-2">Olgan / qaytargan</th><th className="py-1 pr-2">Kassa (oxiri)</th><th className="py-1">Majburiyat (hozir)</th></tr></thead>
                <tbody>
                  {rep.sellers.map((s) => (
                    <tr key={String(s.seller_id)} className="border-t border-slate-800">
                      <td className="py-1 pr-2">{String(s.name)}</td>
                      <td className="py-1 pr-2 font-mono">{String(s.sales_gram_count)} ta · {fmt(s.sales_gram_physical_g, "g")} → {fmt(s.sales_gram_due_g585, "g")}</td>
                      <td className="py-1 pr-2 font-mono">{String(s.sales_uzs_count)} ta · {fmt(s.sales_uzs_amount, "uzs")} · {fmt(s.sales_uzs_physical_g, "g")}</td>
                      <td className="py-1 pr-2 font-mono">{String(s.sales_usd_count)} ta · {fmt(s.sales_usd_amount, "usd")} · {fmt(s.sales_usd_physical_g, "g")}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(s.received_physical_g, "g")} / {fmt(s.returned_physical_g, "g")}</td>
                      <td className="py-1 pr-2 font-mono">{fmt(s.closing_till_uzs, "uzs")} · {fmt(s.closing_till_usd, "usd")}</td>
                      <td className="py-1 font-mono">{fmt(s.live_owes_manager_g585, "g")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-2">
        <h2 className="font-bold text-sm">Hisobot davrlari</h2>
        <p className="text-[11px] text-slate-400">&quot;Yangi davrni boshlash&quot; faqat tanlangan tugash sanasigacha bo&apos;lgan davrni yopib, hisobot nusxasini saqlaydi. Mijoz qarzi, sotuvchi majburiyati, oltin va kassa NOLGA TUSHIRILMAYDI, hech qanday tranzaksiya o&apos;chirilmaydi.</p>
        <button data-testid="report-close-period" type="button" disabled={busy || !rep} onClick={() => void closePeriod()} className="px-3 py-2 rounded-xl bg-slate-800 border border-amber-600 text-amber-300 text-xs font-bold disabled:opacity-50">Yangi davrni boshlash ({to} gacha yopish)</button>
        <ul className="text-xs space-y-1" data-testid="report-periods">
          {periods.map((p) => (
            <li key={p.id} className="flex items-center justify-between border-t border-slate-800 pt-1">
              <span className="font-mono">{p.period_start} — {p.period_end}</span>
              <button type="button" onClick={() => void openStored(p.id)} className="text-amber-300 font-bold">Ko&apos;rish</button>
            </li>
          ))}
          {periods.length === 0 && <li className="text-slate-500">Hali yopilgan davr yo&apos;q</li>}
        </ul>
      </div>
    </div>
  );
}
