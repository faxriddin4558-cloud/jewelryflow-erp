"use client";

// Goldia Sales — seller's own dashboard. Every number comes from an own-scoped source: the seller's A-G
// statement, own markup-difference report, own daily ledger and own consignment pieces (RLS). No company
// totals, manager vault, factory, refining or other sellers' data are requested from this screen.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase, type DailyGoldRateRow } from "@/lib/erp-engine";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";
import { parseErrorMessage } from "@/lib/error-utils";

type Statement = {
  section_b?: { item_count?: number; original_grams?: number };
  section_d?: { outstanding_customer_debt_grams?: number };
  section_e?: { cash_till_uzs?: number; cash_till_usd?: number; scrap_till_grams?: number };
  section_g?: { bozor_qarzi_signed_grams?: number; seller_owes_manager_grams?: number; manager_owes_seller_grams?: number };
};
type LedgerRow = { tx_type: string; status?: string; sold_weight_g?: number; total_payment_g?: number; cash_received_uzs?: number; usd_received?: number };
type Piece = { model_code?: string | null; model_name?: string | null; weight_grams?: number };

export type SellerDashboardData = {
  obligationSigned: number; // < 0: seller owes the manager, > 0: the manager owes the seller
  customersDebtG: number;
  stockG: number;
  stockCount: number;
  stockModels: number;
  tillScrapG: number;
  tillUzs: number;
  tillUsd: number;
  markupDiffG: number | null;
  todaySales: number;
  todaySoldG: number;
  todayPayments: number;
  todayPaidG: number;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Pure aggregation, unit-tested.
export function buildSellerDashboard(st: Statement, pieces: Piece[], todayRows: LedgerRow[], markupDiffG: number | null): SellerDashboardData {
  const g = st.section_g ?? {};
  const signed = g.bozor_qarzi_signed_grams !== undefined
    ? n(g.bozor_qarzi_signed_grams)
    : n(g.manager_owes_seller_grams) - n(g.seller_owes_manager_grams);
  const live = todayRows.filter((r) => r.status !== "reversed" && r.status !== "cancelled");
  const sales = live.filter((r) => r.tx_type === "sale");
  const payments = live.filter((r) => r.tx_type === "payment");
  return {
    obligationSigned: signed,
    customersDebtG: n(st.section_d?.outstanding_customer_debt_grams),
    stockG: pieces.length > 0 ? pieces.reduce((a, p) => a + n(p.weight_grams), 0) : n(st.section_b?.original_grams),
    stockCount: pieces.length > 0 ? pieces.length : n(st.section_b?.item_count),
    stockModels: new Set(pieces.map((p) => p.model_code || p.model_name || "—")).size,
    tillScrapG: n(st.section_e?.scrap_till_grams),
    tillUzs: n(st.section_e?.cash_till_uzs),
    tillUsd: n(st.section_e?.cash_till_usd),
    markupDiffG,
    todaySales: sales.length,
    todaySoldG: sales.reduce((a, r) => a + n(r.sold_weight_g), 0),
    todayPayments: payments.length,
    todayPaidG: payments.reduce((a, r) => a + n(r.total_payment_g), 0),
  };
}

function Tile({ title, children, tone = "slate" }: { title: string; children: React.ReactNode; tone?: "slate" | "rose" | "emerald" | "amber" }) {
  const border = { slate: "border-slate-800", rose: "border-rose-500/40", emerald: "border-emerald-500/40", amber: "border-amber-500/40" }[tone];
  return (
    <div className={`rounded-2xl bg-slate-900 border ${border} p-4 space-y-1 min-w-0`}>
      <div className="text-[11px] uppercase font-bold tracking-wide text-slate-400">{title}</div>
      {children}
    </div>
  );
}

export function SellerDashboard({ sellerName }: { sellerName?: string }) {
  const [data, setData] = useState<SellerDashboardData | null>(null);
  const [rate, setRate] = useState<DailyGoldRateRow | null>(null);
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: empId, error: empErr } = await supabase.rpc("current_employee_id");
      if (empErr || !empId) throw empErr ?? new Error("Xodim aniqlanmadi");
      const today = localToday();
      const [stRes, piecesRes, ledgerRes, markupRes, rateRes] = await Promise.all([
        supabase.rpc("rpc_get_seller_reconciliation_statement", { p_seller_id: empId }),
        supabase.from("consignment_pieces").select("model_code, model_name, weight_grams").eq("seller_id", empId).eq("status", "held_by_seller"),
        supabase.rpc("rpc_get_daily_sales_ledger", { p_seller_id: empId, p_start_date: today, p_end_date: today }),
        supabase.rpc("rpc_get_seller_markup_difference_report", { p_seller_id: empId, p_from: null, p_to: null }),
        supabase.from("daily_gold_rates").select("*").eq("proba", 585).order("rate_date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (stRes.error) throw stRes.error;
      const markup = markupRes.error ? null : n((markupRes.data as { total_difference_g?: number } | null)?.total_difference_g);
      setData(buildSellerDashboard(
        (stRes.data ?? {}) as Statement,
        (piecesRes.data ?? []) as Piece[],
        (ledgerRes.data ?? []) as LedgerRow[],
        markup,
      ));
      setRate(rateRes.data ? (rateRes.data as DailyGoldRateRow) : null);
      try {
        const cbu = await (await fetch("/api/sales/currency/cbu")).json();
        setUsdRate(cbu?.success && Number(cbu.data?.rate) > 0 ? Number(cbu.data.rate) : null);
      } catch {
        setUsdRate(null);
      }
    } catch (e) {
      setError(parseErrorMessage(e, "Ma'lumotlarni yuklab bo'lmadi"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const owes = data ? data.obligationSigned < -0.00005 : false;
  const owed = data ? data.obligationSigned > 0.00005 : false;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-900 border border-slate-800 p-4">
        <div className="min-w-0">
          <div className="text-[11px] uppercase font-bold tracking-wide text-emerald-400">Sotuvchi paneli</div>
          <h1 className="text-lg font-black text-white truncate">{sellerName || "Mening hisobim"}</h1>
        </div>
        <button onClick={() => void load()} disabled={loading} className="shrink-0 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold disabled:opacity-50">
          {loading ? "…" : "🔄 Yangilash"}
        </button>
      </div>

      {error && <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</div>}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Tile title="Mening bozor qarzim (585)" tone={owes ? "rose" : owed ? "emerald" : "slate"}>
            <div data-testid="seller-obligation" className={`font-mono text-2xl font-black ${owes ? "text-rose-400" : owed ? "text-emerald-400" : "text-white"}`}>
              {formatScreenGrams(Math.abs(data.obligationSigned), 3)}
            </div>
            <div className="text-xs text-slate-400">
              {owes ? "Men boshqaruvchiga qarzdorman" : owed ? "Boshqaruvchi menga qarzdor" : "Hisob teng"}
            </div>
          </Tile>

          <Tile title="Mijozlarimning jami qarzi">
            <div className="font-mono text-2xl font-black text-white">{formatScreenGrams(data.customersDebtG, 3)}</div>
            <Link href="/sales/app/customers" className="text-xs text-amber-400 font-bold">Mijozlar ro&apos;yxati →</Link>
          </Tile>

          <Tile title="Mening tovarim (sotilmagan)">
            <div className="font-mono text-2xl font-black text-white">{formatScreenGrams(data.stockG, 3)}</div>
            <div className="text-xs text-slate-400">{data.stockCount} dona · {data.stockModels} model</div>
          </Tile>

          <Tile title="Mening kassam (topshirilmagan)">
            <div className="font-mono text-sm text-white space-y-0.5">
              <div>Lom: <b>{formatScreenGrams(data.tillScrapG, 3)}</b></div>
              <div>Naqd: <b>{formatScreenUZS(data.tillUzs)}</b></div>
              <div>Dollar: <b>{data.tillUsd.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USD</b></div>
            </div>
          </Tile>

          <Tile title="Mening ustama farqim">
            {data.markupDiffG === null ? (
              <div className="text-xs text-slate-400">Yuklab bo&apos;lmadi</div>
            ) : (
              <div className={`font-mono text-2xl font-black ${data.markupDiffG > 0.00005 ? "text-emerald-400" : data.markupDiffG < -0.00005 ? "text-rose-400" : "text-white"}`}>
                {data.markupDiffG > 0.00005 ? "+" : data.markupDiffG < -0.00005 ? "−" : ""}{formatScreenGrams(Math.abs(data.markupDiffG), 3)}
              </div>
            )}
            <div className="text-xs text-slate-400">Sotilgan ustama − tayinlangan ustama</div>
          </Tile>

          <Tile title="Bugungi savdolarim">
            <div className="font-mono text-sm text-white space-y-0.5">
              <div>Savdo: <b>{data.todaySales} ta</b> · {formatScreenGrams(data.todaySoldG, 3)}</div>
              <div>To&apos;lov: <b>{data.todayPayments} ta</b> · {formatScreenGrams(data.todayPaidG, 3)}</div>
            </div>
          </Tile>

          <Tile title="Bugungi kurslar" tone="amber">
            <div className="font-mono text-sm text-white space-y-0.5">
              <div>Lom 585: <b>{rate && Number(rate.rate_per_gram) > 0 ? `${Number(rate.rate_per_gram).toLocaleString("ru-RU")} UZS/g` : "belgilanmagan"}</b></div>
              <div>USD/UZS: <b>{usdRate ? usdRate.toLocaleString("ru-RU") : "—"}</b></div>
            </div>
            <div className="text-[11px] text-slate-500">Kurslarni boshqaruvchi belgilaydi</div>
          </Tile>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/sales/mobile" className="rounded-2xl bg-emerald-600 hover:bg-emerald-500 p-4 text-center text-white font-black text-sm">📱 Savdo / To&apos;lov</Link>
        <Link href="/sales/app/customers" className="rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 p-4 text-center text-white font-black text-sm">🛍️ Mijozlar</Link>
      </div>
    </div>
  );
}
