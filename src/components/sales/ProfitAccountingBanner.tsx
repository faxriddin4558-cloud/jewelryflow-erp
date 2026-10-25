"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase, generateIdempotencyKey, type AccountingProfitSummary, type DailyGoldRateRow } from "@/lib/erp-engine";
import { parseErrorMessage } from "@/lib/error-utils";

interface Props {
  onDataMutated?: () => Promise<void>;
  canManageAccounting?: boolean;
}

export function ProfitAccountingBanner({ onDataMutated, canManageAccounting = true }: Props) {
  const [profitSummary, setProfitSummary] = useState<AccountingProfitSummary | null>(null);
  const [profitLoading, setProfitLoading] = useState(false);
  const [profitError, setProfitError] = useState<string | null>(null);
  const [dailyRate, setDailyRate] = useState<DailyGoldRateRow | null>(null);
  const [cbuUsdRate, setCbuUsdRate] = useState<number | null>(null);

  // Modals state
  const [showComponentModal, setShowComponentModal] = useState(false);
  const [showBaselineModal, setShowBaselineModal] = useState(false);
  const [showFinTxModal, setShowFinTxModal] = useState(false);

  // Form states
  const [busy, setBusy] = useState(false);
  const [baselineNotes, setBaselineNotes] = useState("");
  const [baselineUsdRate, setBaselineUsdRate] = useState("");

  const [txType, setTxType] = useState<"capital_contribution" | "capital_distribution" | "business_expense">("business_expense");
  const [txTill, setTxTill] = useState<"manager_uzs" | "manager_usd" | "manager_vault_gold">("manager_uzs");
  const [txAmount, setTxAmount] = useState("");
  const [txCurrency, setTxCurrency] = useState<"UZS" | "USD" | "585_GOLD">("UZS");
  const [txCategory, setTxCategory] = useState("Ofis va operatsion xarajat");
  const [txNotes, setTxNotes] = useState("");
  const [txGoldRate, setTxGoldRate] = useState("");
  const [txUsdRate, setTxUsdRate] = useState("");
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Load today's rate & CBU USD rate
  useEffect(() => {
    let isMounted = true;
    async function loadRates() {
      try {
        const { data: rateData } = await supabase
          .from("daily_gold_rates")
          .select("*")
          .eq("proba", 585)
          .order("rate_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (isMounted && rateData) {
          setDailyRate(rateData as DailyGoldRateRow);
          if (rateData.rate_per_gram) {
            setTxGoldRate(String(rateData.rate_per_gram));
          }
        }

        // Fetch CBU USD rate
        try {
          const res = await fetch("https://cbu.uz/uz/arkhiv-kursov-valyut/json/");
          if (res.ok) {
            const arr = await res.json();
            const usd = arr.find((item: { Ccy: string }) => item.Ccy === "USD");
            if (usd && usd.Rate && isMounted) {
              const r = parseFloat(usd.Rate);
              setCbuUsdRate(r);
              setBaselineUsdRate(String(r));
              setTxUsdRate(String(r));
            }
          }
        } catch {
          // ignore external API failure
        }
      } catch {
        // ignore
      }
    }
    void loadRates();
    return () => {
      isMounted = false;
    };
  }, []);

  // Synchronize currency when till changes
  useEffect(() => {
    if (txTill === "manager_uzs") {
      setTxCurrency("UZS");
    } else if (txTill === "manager_usd") {
      setTxCurrency("USD");
      if (cbuUsdRate && !txUsdRate) setTxUsdRate(String(cbuUsdRate));
    } else if (txTill === "manager_vault_gold") {
      setTxCurrency("585_GOLD");
    }
  }, [txTill, cbuUsdRate, txUsdRate]);

  // Load accounting profit summary strictly from baseline to now
  const loadProfitSummary = useCallback(async () => {
    setProfitLoading(true);
    setProfitError(null);
    try {
      const { data, error } = await supabase.rpc("rpc_get_accounting_profit_summary", {
        p_start_date: null,
        p_end_date: null,
        p_gold_rate: dailyRate?.is_confirmed ? Number(dailyRate.rate_per_gram) : null,
        p_usd_rate: cbuUsdRate || null,
      });

      if (error) {
        setProfitSummary(null);
        setProfitError(parseErrorMessage(error));
      } else if (data) {
        setProfitSummary(data as unknown as AccountingProfitSummary);
      }
    } catch (err: unknown) {
      setProfitSummary(null);
      setProfitError(parseErrorMessage(err));
    } finally {
      setProfitLoading(false);
    }
  }, [dailyRate?.is_confirmed, dailyRate?.rate_per_gram, cbuUsdRate]);

  useEffect(() => {
    void loadProfitSummary();
  }, [loadProfitSummary]);

  // Handle baseline confirmation
  const handleConfirmBaseline = async () => {
    setBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const idempKey = generateIdempotencyKey("confirm_baseline");
      const { error } = await supabase.rpc("rpc_confirm_accounting_baseline", {
        p_notes: baselineNotes.trim() || null,
        p_idempotency_key: idempKey,
        p_usd_rate: baselineUsdRate ? parseFloat(baselineUsdRate) : null,
      });
      if (error) throw error;
      setActionSuccess("Boshlang'ich hisob holati muvaffaqiyatli muzlatildi va tasdiqlandi!");
      setShowBaselineModal(false);
      setBaselineNotes("");
      if (onDataMutated) await onDataMutated();
      await loadProfitSummary();
    } catch (err: unknown) {
      setActionError(parseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Handle financial transaction
  const handleRecordFinTx = async () => {
    const amt = parseFloat(txAmount);
    if (!amt || amt <= 0) {
      setActionError("Iltimos, summani to'g'ri kiriting (0 dan katta bo'lishi shart)");
      return;
    }
    setBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const idempKey = generateIdempotencyKey("fin_tx");
      const { error } = await supabase.rpc("rpc_record_financial_transaction", {
        p_transaction_type: txType,
        p_source_till: txTill,
        p_amount: amt,
        p_currency: txCurrency,
        p_category: txCategory || null,
        p_notes: txNotes || null,
        p_gold_rate: txGoldRate ? parseFloat(txGoldRate) : (dailyRate ? Number(dailyRate.rate_per_gram) : null),
        p_usd_rate: txUsdRate ? parseFloat(txUsdRate) : null,
        p_idempotency_key: idempKey,
      });
      if (error) throw error;
      setActionSuccess("Moliyaviy operatsiya muvaffaqiyatli yozildi va kassa yangilandi!");
      setShowFinTxModal(false);
      setTxAmount("");
      setTxNotes("");
      if (onDataMutated) await onDataMutated();
      await loadProfitSummary();
    } catch (err: unknown) {
      setActionError(parseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toast Notifications */}
      {actionSuccess && (
        <div className="p-3 bg-emerald-500/20 border border-emerald-500/50 rounded-2xl text-emerald-300 text-xs flex justify-between items-center shadow-lg">
          <span>✓ {actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess(null)} className="text-emerald-400 font-bold ml-2">✕</button>
        </div>
      )}
      {actionError && (
        <div className="p-3 bg-rose-500/20 border border-rose-500/50 rounded-2xl text-rose-300 text-xs flex justify-between items-center shadow-lg">
          <span>⚠️ {actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="text-rose-400 font-bold ml-2">✕</button>
        </div>
      )}

      {/* Main Banner Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-2 border-indigo-500/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="space-y-4 relative z-10">
          {/* Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-500/20 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  Boshqaruv Hisobi (585 Oltin Bazasi)
                </span>
                {profitSummary?.rates?.is_confirmed ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    ✓ Rasmiy Kurs Tasdiqlangan
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    ⚠️ Bugungi Kurs Tasdiqlanmagan
                  </span>
                )}
                {profitSummary?.has_baseline ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    🎯 Boshlang&apos;ich Hisob Faol
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                    ⚠️ Boshlang&apos;ich Hisob Muzlatilmagan (Jonli Preview)
                  </span>
                )}
              </div>
              <h2 className="text-xl md:text-2xl font-black mt-1 text-white flex items-center gap-2">
                Davr hisobiy foyda / zarar — 585 g
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Boshlang&apos;ich nuqtadan yoki tanlangan davrdan beri korxona sof oltin kapitalining o&apos;zgarishi (FX drift ajratilgan)
              </p>

              {/* Explanatory Banner for Missing / Uncalculated State */}
              {profitSummary && (!profitSummary.is_computable || (profitSummary.missing_data && profitSummary.missing_data.length > 0)) && (
                <div className="mt-3 p-3 bg-amber-950/80 border border-amber-600/50 rounded-2xl text-amber-200 text-xs shadow-lg">
                  <div className="font-bold flex items-center gap-1.5 text-amber-300">
                    <span>ℹ️</span> Ma&apos;lumot: Yakuniy foyda/zarar hisobi hozircha to&apos;liq emas
                  </div>
                  <ul className="list-disc list-inside mt-1.5 space-y-0.5 text-amber-100 font-mono text-[11px]">
                    {profitSummary.missing_data?.map((m: string, idx: number) => (
                      <li key={idx}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* RPC Error Display */}
              {profitError && (
                <div className="mt-3 p-3 bg-rose-950/80 border border-rose-600/50 rounded-2xl text-rose-200 text-xs shadow-lg">
                  <div className="font-bold flex items-center gap-1.5 text-rose-300">
                    <span>⚠️</span> Xatolik yuz berdi:
                  </div>
                  <p className="mt-1 font-mono text-[11px]">{profitError}</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {canManageAccounting && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowComponentModal(true)}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow"
                >
                  🔍 Tarkibini ko&apos;rish
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (dailyRate) setTxGoldRate(String(dailyRate.rate_per_gram));
                    setShowFinTxModal(true);
                  }}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-emerald-600/20"
                >
                  💸 Xarajat / Kapital amali
                </button>
                <button
                  type="button"
                  onClick={() => setShowBaselineModal(true)}
                  className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-amber-500/20"
                >
                  🎯 Hisobni boshlash
                </button>
              </div>
            )}
          </div>

          {/* Profit Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            {/* 1. Main Profit Figure (FAIL-CLOSED: NEVER "?? 0") */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
              <div>
                <div className="text-xs text-slate-400 font-bold">Sof Aktiv O&apos;zgarishi (585 g)</div>
                <div className="text-[10px] text-slate-500 font-medium">Kapital harakatlariga tuzatilgan</div>
              </div>
              <div className="my-2">
                {profitLoading ? (
                  <div className="text-xl font-bold text-slate-400 animate-pulse">Yuklanmoqda...</div>
                ) : profitSummary && profitSummary.is_computable && profitSummary.period_accounting_result_585_g !== null ? (
                  <div
                    className={`text-2xl md:text-3xl font-black font-mono ${
                      profitSummary.period_accounting_result_585_g > 0
                        ? "text-emerald-400"
                        : profitSummary.period_accounting_result_585_g < 0
                        ? "text-rose-400"
                        : "text-slate-200"
                    }`}
                  >
                    {profitSummary.period_accounting_result_585_g > 0 ? "+" : ""}
                    {profitSummary.period_accounting_result_585_g.toFixed(4)}
                    <span className="text-sm font-bold text-slate-300"> g (585)</span>
                  </div>
                ) : (
                  <div className="text-lg md:text-xl font-black text-amber-400/90 flex items-center gap-2">
                    <span>—</span>
                    <span>Hisoblanmagan</span>
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 font-sans">
                <span className="text-slate-400 leading-tight block">
                  ℹ️ Pilot davrida korxona sof aktivlarining 585 ekvivalentidagi o&apos;zgarishi asosiy boshqaruv mezoni hisoblanadi. Savdo marjasi va kurs tafovutini alohida ajratish to&apos;liq partiyaviy konvertatsiya tahlili yakunlangach taqdim etiladi.
                </span>
              </div>
            </div>

            {/* 2. Net Assets (Live Preview even before baseline!) */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
              <div>
                <div className="text-xs text-slate-400 font-bold flex items-center justify-between">
                  <span>Joriy Sof Aktiv (585 g)</span>
                  {!profitSummary?.has_baseline && (
                    <span className="text-[10px] text-cyan-400 font-mono font-bold bg-cyan-950 px-1.5 py-0.5 rounded">
                      Jonli Preview
                    </span>
                  )}
                </div>
                <div className="text-xl md:text-2xl font-black font-mono text-cyan-300 mt-1">
                  {profitSummary && profitSummary.current_net_assets_585_g !== null ? (
                    <>
                      {profitSummary.current_net_assets_585_g.toFixed(4)}{" "}
                      <span className="text-xs text-slate-300">g</span>
                    </>
                  ) : (
                    <span className="text-base text-amber-400">Kurs kiritilmagan</span>
                  )}
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 font-mono">
                {profitSummary && profitSummary.current_total_assets_585_g !== null ? (
                  <>
                    Aktivlar:{" "}
                    <strong className="text-emerald-400">
                      {profitSummary.current_total_assets_585_g.toFixed(4)} g
                    </strong>{" "}
                    — Majburiyat:{" "}
                    <strong className="text-rose-400">
                      {(profitSummary.current_total_liabilities_585_g ?? 0).toFixed(4)} g
                    </strong>
                  </>
                ) : (
                  <span className="text-slate-500">Hisob-kitob kutilmoqda</span>
                )}
              </div>
            </div>

            {/* 3. Baseline Info */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
              <div>
                <div className="text-xs text-slate-400 font-bold">Boshlang&apos;ich Hisob (Muzlatilgan)</div>
                <div className="text-xl md:text-2xl font-black font-mono text-amber-300 mt-1">
                  {profitSummary?.baseline
                    ? `${profitSummary.baseline.net_assets_585_g.toFixed(4)} g`
                    : "Muzlatilmagan"}
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
                {profitSummary?.baseline ? (
                  <span>
                    Sana:{" "}
                    <strong className="text-white">
                      {new Date(profitSummary.baseline.baseline_date).toLocaleDateString()}
                    </strong>{" "}
                    ({profitSummary.baseline.baseline_no})
                  </span>
                ) : (
                  <span className="text-amber-400/90 font-medium">Boshlang&apos;ich nuqtani tasdiqlang</span>
                )}
              </div>
            </div>

            {/* 4. Capital Adjustments & Expenses */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
              <div className="text-xs text-slate-400 font-bold">Kapital va Rasmiy Xarajatlar</div>
              <div className="space-y-1 mt-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Qo&apos;shilgan kapital:</span>
                  <strong className="text-emerald-400">
                    +{Number(profitSummary?.capital_contributions_585_g || 0).toFixed(4)} g
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Chiqarilgan foyda:</span>
                  <strong className="text-amber-400">
                    -{Number(profitSummary?.capital_distributions_585_g || 0).toFixed(4)} g
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Rasmiy xarajatlar:</span>
                  <strong className="text-rose-400">
                    -{Number(profitSummary?.business_expenses_585_g || 0).toFixed(4)} g
                  </strong>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-slate-500 border-t border-slate-800/80 pt-1">
                Formula: Joriy Aktiv — Boshlang&apos;ich — Kiritilgan + Yechilgan
              </div>
            </div>
          </div>

          {/* Pilot Period Status Bar */}
          <div className="mt-4 pt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-amber-400 font-bold flex items-center gap-1.5">
                <span>🔒</span> Pilot Hisob Davri:
              </span>
              <span className="font-mono bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 text-xs">
                {profitSummary?.baseline?.baseline_date
                  ? new Date(profitSummary.baseline.baseline_date).toLocaleDateString("uz-UZ", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Boshlang'ich hisob kutilmoqda"}{" "}
                → Hozirgacha (Jonli real-time)
              </span>
              <span className="text-slate-400 text-[11px] hidden md:inline italic">
                (Oylik tarixiy snapshotlar moduli keyingi bosqichda yoqiladi)
              </span>
            </div>

            <div className="text-[11px] text-slate-400">
              Hisoblash vaqti (Asia/Tashkent):{" "}
              <span className="font-mono text-slate-300">
                {profitSummary?.as_of_time
                  ? new Date(profitSummary.as_of_time).toLocaleTimeString("uz-UZ", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL 1: TARKIBINI KO'RISH (COMPONENTS MODAL) */}
      {showComponentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-4 text-slate-800 my-8">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-black text-lg text-slate-900 flex items-center gap-2">
                  <span>📊</span> Korxona Aktiv va Majburiyatlari Tarkibi
                </h3>
                <p className="text-xs text-slate-500">
                  Barcha aktivlar va tashqi majburiyatlarning bandma-band jonli holati
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowComponentModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold p-1 text-lg"
              >
                ✕
              </button>
            </div>

            {/* Rates banner */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3 flex flex-wrap justify-between items-center text-xs">
              <div>
                <span className="text-indigo-900 font-bold">Qo&apos;llangan Kurs: </span>
                <span className="font-mono font-bold text-indigo-700">
                  585 Lom = {Number(profitSummary?.rates?.gold_rate_585 || 0).toLocaleString()} UZS/g
                </span>
                <span className="mx-2 text-indigo-300">|</span>
                <span className="font-mono font-bold text-indigo-700">
                  USD = {Number(profitSummary?.rates?.usd_rate || 0).toLocaleString()} UZS
                </span>
              </div>
              <span className="text-[11px] text-indigo-600 font-medium">
                {profitSummary?.rates?.is_confirmed ? "✓ Tasdiqlangan" : "⚠️ Vaqtinchalik / Kiritilmagan"}
              </span>
            </div>

            {/* Two Column Breakdown: Assets vs Liabilities */}
            <div className="space-y-4 text-xs">
              {/* ASSETS SECTION */}
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-emerald-700 mb-2 flex items-center justify-between">
                  <span>1. Jami Aktivlar (585 g Ekvivalenti)</span>
                  <span className="font-mono text-sm">
                    {Number(profitSummary?.current_total_assets_585_g || 0).toFixed(4)} g
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl divide-y divide-slate-200 overflow-hidden font-mono">
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <span className="font-sans text-slate-600">Menejerdagi tayyor mahsulot:</span>
                    <strong className="text-slate-900">
                      {Number(profitSummary?.components?.manager_finished_goods_585_g || 0).toFixed(4)} g
                    </strong>
                  </div>
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <span className="font-sans text-slate-600">Sotuvchilardagi tayyor mahsulot:</span>
                    <strong className="text-slate-900">
                      {Number(profitSummary?.components?.sellers_finished_goods_585_g || 0).toFixed(4)} g
                    </strong>
                  </div>
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <span className="font-sans text-slate-600">Menejerdagi lom oltin (585 eq):</span>
                    <div className="text-right">
                      <strong className="text-slate-900">
                        {Number(profitSummary?.components?.manager_scrap_585_eq_g || 0).toFixed(4)} g
                      </strong>
                      <div className="text-[10px] text-slate-400 font-sans">
                        Fizik: {Number(profitSummary?.components?.manager_scrap_physical_g || 0).toFixed(4)} g
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <span className="font-sans text-slate-600">Sotuvchilardagi lom oltin (585 eq):</span>
                    <div className="text-right">
                      <strong className="text-slate-900">
                        {Number(profitSummary?.components?.sellers_scrap_585_eq_g || 0).toFixed(4)} g
                      </strong>
                      <div className="text-[10px] text-slate-400 font-sans">
                        Fizik: {Number(profitSummary?.components?.sellers_scrap_physical_g || 0).toFixed(4)} g
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <span className="font-sans text-slate-600">Menejerdagi afinaj toza oltin (585 eq):</span>
                    <strong className="text-slate-900">
                      {Number(profitSummary?.components?.manager_refined_gold_585_g || 0).toFixed(4)} g
                    </strong>
                  </div>
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <span className="font-sans text-slate-600">Menejerdagi xarid qilingan oltin (585 eq):</span>
                    <strong className="text-slate-900">
                      {Number(profitSummary?.components?.manager_purchased_gold_585_g || 0).toFixed(4)} g
                    </strong>
                  </div>
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <span className="font-sans text-slate-600">Mijozlarning haqiqiy qarzlari (585 eq):</span>
                    <strong className="text-slate-900">
                      {Number(profitSummary?.components?.customer_debts_585_g || 0).toFixed(4)} g
                    </strong>
                  </div>
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <div>
                      <span className="font-sans text-slate-600">Naqd pul (UZS): </span>
                      <span className="text-slate-500 font-sans text-[11px]">
                        (Seyf: {Number(profitSummary?.components?.manager_cash_uzs || 0).toLocaleString()} | Kassalar: {Number(profitSummary?.components?.sellers_cash_uzs || 0).toLocaleString()})
                      </span>
                    </div>
                    <div className="text-right">
                      <strong className="text-slate-900">
                        {Number(profitSummary?.components?.cash_uzs_585_eq_g || 0).toFixed(4)} g
                      </strong>
                      <div className="text-[10px] text-slate-400 font-sans">
                        {Number(profitSummary?.components?.cash_uzs_amount || 0).toLocaleString()} UZS
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <div>
                      <span className="font-sans text-slate-600">Dollar (USD): </span>
                      <span className="text-slate-500 font-sans text-[11px]">
                        (Seyf: ${Number(profitSummary?.components?.manager_cash_usd || 0).toLocaleString()} | Kassalar: ${Number(profitSummary?.components?.sellers_cash_usd || 0).toLocaleString()})
                      </span>
                    </div>
                    <div className="text-right">
                      <strong className="text-slate-900">
                        {Number(profitSummary?.components?.cash_usd_585_eq_g || 0).toFixed(4)} g
                      </strong>
                      <div className="text-[10px] text-slate-400 font-sans">
                        ${Number(profitSummary?.components?.cash_usd_amount || 0).toLocaleString()} USD
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* LIABILITIES SECTION */}
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-rose-700 mb-2 flex items-center justify-between">
                  <span>2. Tashqi Majburiyatlar</span>
                  <span className="font-mono text-sm">
                    {Number(profitSummary?.current_total_liabilities_585_g || 0).toFixed(4)} g
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl divide-y divide-slate-200 overflow-hidden font-mono">
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <span className="font-sans text-slate-600">Zavod oldidagi tovar majburiyati:</span>
                    <strong className="text-rose-600">
                      {Number(profitSummary?.components?.factory_obligation_585_g || 0).toFixed(4)} g
                    </strong>
                  </div>
                  <div className="p-2.5 px-3 flex justify-between items-center">
                    <span className="font-sans text-slate-600">Mijozlarning haqi / avanslari:</span>
                    <strong className="text-rose-600">
                      {Number(profitSummary?.components?.customer_advances_585_g || 0).toFixed(4)} g
                    </strong>
                  </div>
                </div>
              </div>

              {/* NET ASSETS SUMMARY */}
              <div className="bg-slate-900 text-white rounded-2xl p-4 flex justify-between items-center">
                <div>
                  <div className="text-xs font-bold text-slate-400">JAMI SOF AKTIV (585 G)</div>
                  <div className="text-xs text-slate-300 font-sans">Aktivlar minus Tashqi Majburiyatlar</div>
                </div>
                <div className="text-2xl font-black font-mono text-cyan-300">
                  {Number(profitSummary?.current_net_assets_585_g || 0).toFixed(4)} g
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowComponentModal(false)}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: HISOBNI BOSHLASH (BASELINE MODAL) */}
      {showBaselineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-amber-200 max-w-md w-full p-6 space-y-4 text-slate-800">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🎯</span>
                <h3 className="font-black text-lg text-slate-900">
                  Boshlang&apos;ich Hisobni Muzlatish
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowBaselineModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900 space-y-1.5">
              <p className="font-bold flex items-center gap-1.5 text-amber-950">
                <span>⚠️</span> Muhim Boshqaruv Qadami:
              </p>
              <p>
                Ushbu amal joriy omborlar, kassalar, mijoz qarzlari va zavod majburiyatlarini o&apos;sha holaticha <strong>muzlatadi</strong>.
              </p>
              <p>
                Kelgusi sof foyda yoki zarar aynan shu boshlang&apos;ich nuqtadan boshlab hisoblanadi.
              </p>
            </div>

            {/* Live Preview Before Freeze */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Joriy Sof Aktiv (Muzlatiladigan):</span>
                <strong className="text-slate-900 font-bold">
                  {Number(profitSummary?.current_net_assets_585_g || 0).toFixed(4)} g (585)
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Bugungi 585 kursi:</span>
                <strong className={profitSummary?.rates?.gold_rate_585 ? "text-slate-900" : "text-rose-600 font-bold"}>
                  {profitSummary?.rates?.gold_rate_585
                    ? `${profitSummary.rates.gold_rate_585.toLocaleString()} UZS/g`
                    : "Tasdiqlanmagan"}
                </strong>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Bugungi USD kursi (Kassada dollar bo&apos;lsa):
              </label>
              <input
                type="number"
                value={baselineUsdRate}
                onChange={(e) => setBaselineUsdRate(e.target.value)}
                placeholder={cbuUsdRate ? `${cbuUsdRate} UZS (CBU kursi)` : "Masalan: 12850"}
                className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Boshlang&apos;ich hisob izohi:
              </label>
              <textarea
                rows={2}
                value={baselineNotes}
                onChange={(e) => setBaselineNotes(e.target.value)}
                placeholder="Masalan: 2026-yil 25-oktabr Goldia Sales MVP rasmiy ishga tushishi"
                className="w-full text-xs p-3 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowBaselineModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 transition"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirmBaseline()}
                className="px-5 py-2 text-xs font-black rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 disabled:opacity-50 transition"
              >
                {busy ? "Muzlatilmoqda..." : "Ha, Boshlang'ich Nuqtani Tasdiqlash"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: XARAJAT / KAPITAL AMALI */}
      {showFinTxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 text-slate-800 my-8">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">💸</span>
                <h3 className="font-black text-lg text-slate-900">
                  Xarajat / Kapital Operatsiyasi
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowFinTxModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Type Selector */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Operatsiya turi:</label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setTxType("business_expense");
                      setTxCategory("Ofis va operatsion xarajat");
                    }}
                    className={`p-2 rounded-xl border text-center font-bold text-[11px] transition ${
                      txType === "business_expense"
                        ? "bg-rose-50 border-rose-400 text-rose-800 ring-2 ring-rose-400/20"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    📉 Xarajat
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTxType("capital_contribution");
                      setTxCategory("Ta'sischi hissasi");
                    }}
                    className={`p-2 rounded-xl border text-center font-bold text-[11px] transition ${
                      txType === "capital_contribution"
                        ? "bg-emerald-50 border-emerald-400 text-emerald-800 ring-2 ring-emerald-400/20"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    📈 Kapital Kiritish
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTxType("capital_distribution");
                      setTxCategory("Foyda taqsimoti");
                    }}
                    className={`p-2 rounded-xl border text-center font-bold text-[11px] transition ${
                      txType === "capital_distribution"
                        ? "bg-amber-50 border-amber-400 text-amber-800 ring-2 ring-amber-400/20"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    💰 Foyda Chiqarish
                  </button>
                </div>
              </div>

              {/* Source Till Selector */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Kassa / Seyf:</label>
                <select
                  value={txTill}
                  onChange={(e) => setTxTill(e.target.value as "manager_uzs" | "manager_usd" | "manager_vault_gold")}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                >
                  <option value="manager_uzs">Menejer Seyfi (UZS Naqd Pul)</option>
                  <option value="manager_usd">Menejer Seyfi (USD Dollar)</option>
                  <option value="manager_vault_gold">Menejer Seyfi (585 Sof/Afinaj Oltin)</option>
                </select>
              </div>

              {/* Amount & Currency */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Miqdor ({txCurrency === "585_GOLD" ? "Gramm (585)" : txCurrency}):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step={txCurrency === "585_GOLD" ? "0.0001" : "1"}
                    value={txAmount}
                    onChange={(e) => setTxAmount(e.target.value)}
                    placeholder={txCurrency === "585_GOLD" ? "0.0000" : "0"}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none pr-16"
                    required
                  />
                  <span className="absolute right-3 top-2.5 text-slate-400 font-bold font-mono text-xs">
                    {txCurrency}
                  </span>
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Kategoriya:</label>
                <input
                  type="text"
                  value={txCategory}
                  onChange={(e) => setTxCategory(e.target.value)}
                  placeholder="Masalan: Do'kon ijarasi, Ish haqi..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Izoh / Hujjat asos:</label>
                <input
                  type="text"
                  value={txNotes}
                  onChange={(e) => setTxNotes(e.target.value)}
                  placeholder="Qo'shimcha izoh..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              {/* Rates applied display */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-[11px] font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Bugungi 585 kursi:</span>
                  <strong>{dailyRate ? Number(dailyRate.rate_per_gram).toLocaleString() : "—"} UZS/g</strong>
                </div>
                {txCurrency === "USD" && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">USD kursi:</span>
                    <strong>{txUsdRate ? Number(txUsdRate).toLocaleString() : "—"} UZS</strong>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowFinTxModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 transition"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRecordFinTx()}
                className="px-5 py-2 text-xs font-black rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 disabled:opacity-50 transition"
              >
                {busy ? "Saqlanmoqda..." : "Tasdiqlash & Yozish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
