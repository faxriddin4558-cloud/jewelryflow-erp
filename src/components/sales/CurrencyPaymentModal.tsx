"use client";

// Goldia Sales 077 — payment of a customer's UZS / USD debt (debts of "aniq narx" sales). Same currency 1:1; another
// currency or scrap is converted at the operation rate that is stored on the payment: a seller's own LOM / USD rates
// (shown, not editable, the server checks them), the director / manager enters the rate. One idempotency key per opened
// dialog, so a double click or a retry books the payment once.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/erp-engine";
import { parseErrorMessage } from "@/lib/error-utils";
import { isSellerRole } from "@/lib/sales-payment-rates";

type Props = {
  customer: { id: string; contact_name: string; seller_id?: string | null };
  currentRole: string;
  onClose: () => void;
  onDone: (text: string) => void;
};
type Bal = { currency: "UZS" | "USD"; debt_amount: number; advance_amount: number };
type Hist = { id: string; settlement_no: string; debt_currency: string; credited_amount: number; cash_uzs: number; usd_amount: number; scrap_physical_g: number; scrap_proba: number | null; rate_usd_uzs: number | null; rate_lom_uzs: number | null; status: string; settlement_date: string };

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export function CurrencyPaymentModal({ customer, currentRole, onClose, onDone }: Props) {
  const seller = isSellerRole(currentRole);
  const [bal, setBal] = useState<Bal[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [currency, setCurrency] = useState<"UZS" | "USD">("USD");
  const [cash, setCash] = useState("");
  const [usd, setUsd] = useState("");
  const [scrap, setScrap] = useState("");
  const [proba, setProba] = useState("585");
  const [usdRate, setUsdRate] = useState("");
  const [lomRate, setLomRate] = useState("");
  const [ownRates, setOwnRates] = useState<{ lom: number | null; usd: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key] = useState(() => `CPAY-${customer.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const load = useCallback(async () => {
    const b = await supabase.from("client_currency_accounts").select("currency, debt_amount, advance_amount").eq("customer_id", customer.id);
    if (!b.error) {
      const rows = (b.data ?? []) as Bal[];
      setBal(rows);
      const owed = rows.find((x) => Number(x.debt_amount) > 0);
      if (owed) setCurrency(owed.currency);
    }
    const h = await supabase.from("client_currency_settlements")
      .select("id, settlement_no, debt_currency, credited_amount, cash_uzs, usd_amount, scrap_physical_g, scrap_proba, rate_usd_uzs, rate_lom_uzs, status, settlement_date")
      .eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(20);
    if (!h.error) setHist((h.data ?? []) as Hist[]);
    if (seller) {
      const r = await supabase.rpc("rpc_get_seller_rates");
      const row = ((r.data?.sellers ?? []) as { lom_rate_uzs?: number | null; usd_rate_uzs?: number | null }[])[0];
      const lom = row?.lom_rate_uzs ? Number(row.lom_rate_uzs) : r.data?.official_585_rate ? Number(r.data.official_585_rate) : null;
      const usdOwn = row?.usd_rate_uzs ? Number(row.usd_rate_uzs) : null;
      setOwnRates({ lom, usd: usdOwn });
      // 084: the saved rates are only the pre-filled default - the seller may change them for this payment
      setUsdRate((v) => v || (usdOwn ? String(usdOwn) : ""));
      setLomRate((v) => v || (lom ? String(lom) : ""));
    }
  }, [customer.id, seller]);

  useEffect(() => {
    void load();
  }, [load]);

  const cashN = parseFloat(cash) || 0;
  const usdN = parseFloat(usd) || 0;
  const scrapN = parseFloat(scrap) || 0;
  const probaN = parseFloat(proba) || 585;
  const uRate = parseFloat(usdRate) || 0;
  const lRate = parseFloat(lomRate) || 0;
  const scrap585 = scrapN > 0 ? r4(scrapN * (probaN / 585)) : 0;
  const needUsdRate = (currency === "USD" && (cashN > 0 || scrapN > 0)) || (currency === "UZS" && usdN > 0);
  const credited = useMemo(() => {
    if (currency === "UZS") return r2(cashN + usdN * uRate + scrap585 * lRate);
    return r2(usdN + (cashN > 0 || scrapN > 0 ? (cashN + scrap585 * lRate) / (uRate || NaN) : 0));
  }, [currency, cashN, usdN, scrapN, scrap585, uRate, lRate]);
  const cur = bal.find((b) => b.currency === currency);

  const pay = async () => {
    setErr(null);
    if (cashN < 0 || usdN < 0 || scrapN < 0) return setErr("Summalar manfiy bo'lishi mumkin emas");
    if (cashN <= 0 && usdN <= 0 && scrapN <= 0) return setErr("To'lov summasini kiriting");
    if (needUsdRate && !(uRate > 0)) return setErr("USD kursini kiriting");
    if (scrapN > 0 && !(lRate > 0)) return setErr("LOM (585) kursini kiriting");
    setBusy(true);
    const { data, error } = await supabase.rpc("rpc_record_client_currency_settlement", {
      p_customer_id: customer.id, p_currency: currency, p_cash_uzs: cashN, p_usd_amount: usdN, p_scrap_weight: scrapN,
      p_scrap_proba: scrapN > 0 ? probaN : null, p_usd_rate: needUsdRate ? uRate : null, p_lom_rate: scrapN > 0 ? lRate : null,
      p_seller_id: seller ? null : customer.seller_id ?? null, p_notes: null, p_idempotency_key: `${key}:${currency}:${cashN}:${usdN}:${scrapN}:${probaN}`,
    });
    setBusy(false);
    if (error) return setErr(parseErrorMessage(error, "To'lovni saqlab bo'lmadi"));
    onDone(`Valyuta to'lovi saqlandi (${customer.contact_name}): ${Number(data.credited_amount).toLocaleString("ru-RU")} ${currency}. Qolgan qarz: ${Number(data.new_debt).toLocaleString("ru-RU")} ${currency}${Number(data.new_advance) > 0 ? `, avans ${Number(data.new_advance).toLocaleString("ru-RU")} ${currency}` : ""}.`);
  };

  const reverse = async (h: Hist) => {
    const reason = window.prompt(`${h.settlement_no} to'lovini bekor qilish sababi:`);
    if (!reason || !reason.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("rpc_reverse_client_currency_settlement", { p_settlement_id: h.id, p_reason: reason.trim(), p_idempotency_key: `CPREV-${h.id}` });
    setBusy(false);
    if (error) return setErr(parseErrorMessage(error, "Bekor qilib bo'lmadi"));
    await load();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" data-testid="currency-payment-modal">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-5 text-white space-y-3 my-8">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-emerald-300">💵 Valyuta qarziga to&apos;lov — {customer.contact_name}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 font-bold">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs" data-testid="currency-balances">
          {(["UZS", "USD"] as const).map((c) => {
            const b = bal.find((x) => x.currency === c);
            return (
              <button key={c} type="button" onClick={() => setCurrency(c)} data-testid={`currency-tab-${c}`}
                className={`p-2 rounded-xl border text-left ${currency === c ? "border-emerald-500 bg-emerald-950/40" : "border-slate-700 bg-slate-950"}`}>
                <div className="font-bold">{c} qarz</div>
                <div className="font-mono text-rose-300">{Number(b?.debt_amount ?? 0).toLocaleString("ru-RU")} {c}</div>
                {Number(b?.advance_amount ?? 0) > 0 && <div className="font-mono text-cyan-300">avans {Number(b?.advance_amount).toLocaleString("ru-RU")} {c}</div>}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="space-y-1"><span className="text-slate-400">Naqd so&apos;m</span>
            <input data-testid="cpay-cash" type="number" min="0" step="1" value={cash} onChange={(e) => setCash(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 font-mono" /></label>
          <label className="space-y-1"><span className="text-slate-400">Dollar (USD)</span>
            <input data-testid="cpay-usd" type="number" min="0" step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 font-mono" /></label>
          <label className="space-y-1"><span className="text-slate-400">Lom (fizik g)</span>
            <input data-testid="cpay-scrap" type="number" min="0" step="0.0001" value={scrap} onChange={(e) => setScrap(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 font-mono" /></label>
          <label className="space-y-1"><span className="text-slate-400">Proba</span>
            <select value={proba} onChange={(e) => setProba(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2"><option value="585">585</option><option value="750">750</option></select></label>
          {seller && (
            <div className="col-span-2 text-[11px] text-slate-400" data-testid="cpay-own-rates">Saqlangan kurslaringiz (shu to&apos;lov uchun o&apos;zgartirish mumkin): USD {ownRates?.usd ? ownRates.usd.toLocaleString("ru-RU") : "belgilanmagan"} so&apos;m, LOM {ownRates?.lom ? ownRates.lom.toLocaleString("ru-RU") : "—"} so&apos;m/g</div>
          )}
          <label className="space-y-1"><span className="text-slate-400">USD kursi (so&apos;m)</span>
            <input data-testid="cpay-usd-rate" type="number" min="0" step="1" value={usdRate} onChange={(e) => setUsdRate(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 font-mono" /></label>
          <label className="space-y-1"><span className="text-slate-400">LOM 585 kursi (so&apos;m/g)</span>
            <input data-testid="cpay-lom-rate" type="number" min="0" step="1" value={lomRate} onChange={(e) => setLomRate(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 font-mono" /></label>
        </div>
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1" data-testid="cpay-preview">
          <div>Qarzga yoziladi: <b className="font-mono">{Number.isFinite(credited) ? credited.toLocaleString("ru-RU") : "—"} {currency}</b>{scrap585 > 0 && <span className="text-slate-400"> (lom {scrap585} g 585)</span>}</div>
          <div className="text-slate-400">Hozirgi {currency} qarz: {Number(cur?.debt_amount ?? 0).toLocaleString("ru-RU")}; ortiqchasi avansga o&apos;tadi. Pul / lom sotuvchi kassasiga bir marta tushadi.</div>
        </div>
        {err && <div className="text-xs text-rose-300" data-testid="cpay-error">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl bg-slate-800 text-xs font-bold">Yopish</button>
          <button type="button" data-testid="cpay-submit" disabled={busy} onClick={() => void pay()} className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black disabled:opacity-50">{busy ? "Saqlanmoqda..." : "To'lovni saqlash"}</button>
        </div>
        {hist.length > 0 && (
          <div className="text-[11px] space-y-1 border-t border-slate-800 pt-2" data-testid="cpay-history">
            {hist.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2">
                <span className="font-mono">{h.settlement_date} {h.settlement_no}: {Number(h.credited_amount).toLocaleString("ru-RU")} {h.debt_currency}{h.status === "reversed" ? " (bekor)" : ""}</span>
                {!seller && h.status !== "reversed" && <button type="button" disabled={busy} onClick={() => void reverse(h)} className="text-rose-300 font-bold">↩️</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
