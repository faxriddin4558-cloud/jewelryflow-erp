"use client";
import { useState, useEffect, useCallback } from "react";
import {
  supabase,
  GoldEngine,
  ERP_REPORT_TYPES,
  buildErpReportRows,
  downloadExcelCsv,
  type ErpReportType,
  type InventoryItemRow,
  type GoldTransactionRow,
  type BatchRow,
  type BatchStageWipRow,
  type OrderRow,
  type SaleRow,
  type DebtRepaymentRow,
  type MachineRow,
  type ConsumptionRow,
  type ProductRow,
  type EmployeeRow,
  type SalaryLedgerRow,
  type QualityControlRow,
  type HandoverAuditRow,
} from "@/lib/erp-engine";

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState<ErpReportType>(ERP_REPORT_TYPES[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [inv, setInv] = useState<InventoryItemRow[]>([]);
  const [goldTx, setGoldTx] = useState<GoldTransactionRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [wipRows, setWipRows] = useState<BatchStageWipRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [debtRepayments, setDebtRepayments] = useState<DebtRepaymentRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [consumption, setConsumption] = useState<ConsumptionRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [salaryLedger, setSalaryLedger] = useState<SalaryLedgerRow[]>([]);
  const [qcLogs, setQcLogs] = useState<QualityControlRow[]>([]);
  const [handovers, setHandovers] = useState<HandoverAuditRow[]>([]);

  const loadAll = useCallback(async () => {
    const [i, g, b, w, o, s, dr, m, c, p, e, sl, q, h] = await Promise.all([
      supabase.from("inventory_items").select("*"),
      supabase.from("gold_transactions").select("*").order("created_at", { ascending: false }),
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("batch_stage_wip").select("*").order("stage_order"),
      supabase.from("orders").select("*"),
      supabase.from("sales").select("*").order("created_at", { ascending: false }),
      supabase.from("debt_repayments").select("*").order("created_at", { ascending: false }),
      supabase.from("machines").select("*"),
      supabase.from("consumption").select("*").order("created_at", { ascending: false }),
      supabase.from("products").select("*"),
      supabase.from("employees").select("*"),
      supabase.from("salary_ledger").select("*").order("created_at", { ascending: false }),
      supabase.from("quality_control").select("*").order("created_at", { ascending: false }),
      supabase.from("two_party_handovers").select("*").order("dispatched_at", { ascending: false }),
    ]);
    if (i.data) setInv(i.data as InventoryItemRow[]);
    if (g.data) setGoldTx(g.data as GoldTransactionRow[]);
    if (b.data) setBatches(b.data as BatchRow[]);
    if (w.data) setWipRows(w.data as BatchStageWipRow[]);
    if (o.data) setOrders(o.data as OrderRow[]);
    if (s.data) setSales(s.data as SaleRow[]);
    if (dr.data) setDebtRepayments(dr.data as DebtRepaymentRow[]);
    if (m.data) setMachines(m.data as MachineRow[]);
    if (c.data) setConsumption(c.data as ConsumptionRow[]);
    if (p.data) setProducts(p.data as ProductRow[]);
    if (e.data) setEmployees(e.data as EmployeeRow[]);
    if (sl.data) setSalaryLedger(sl.data as SalaryLedgerRow[]);
    if (q.data) setQcLogs(q.data as QualityControlRow[]);
    if (h.data) setHandovers(h.data as HandoverAuditRow[]);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const { rawGoldOnHand, reservedGold, availableGold, fineGoldTotal } =
    GoldEngine.calculateSafeGoldSummary(inv);
  const { kassaIn, kassaOut, kassaNet, customerDebt } = GoldEngine.calculateFinancialSummary(
    sales,
    orders
  );

  const allRows = buildErpReportRows(selectedReport, {
    inv,
    goldTx,
    batches,
    wipRows,
    handovers,
    orders,
    sales,
    debtRepayments,
    machines,
    consumption,
    products,
    employees,
    salaryLedger,
    qcLogs,
  });

  const headerRow = allRows[0] ?? [];
  const dataRows = allRows.slice(1).filter((row) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return row.some((cell) => String(cell ?? "").toLowerCase().includes(q));
  });

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            📑 Hisobotlar va Analitika Markazi (20 ta Real Hisobot &amp; Excel Eksport)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Oltin balansi, 999 sof ekvivalent, ishlab chiqarish WIP, pateriya, sotuv, kassa, qarzlar va ish haqi hisobotlari
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void loadAll()}
            className="bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold px-3.5 py-2.5 rounded-xl"
          >
            🔄 Yangilash
          </button>
          <button
            onClick={() => downloadExcelCsv(selectedReport, [headerRow, ...dataRows])}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow"
          >
            📥 Excel (CSV) Yuklab Olish
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border shadow-sm">
          <div className="text-xs font-bold text-amber-700">SAFE OLTIN BALANSI</div>
          <div className="text-xl font-black mt-1">{rawGoldOnHand.toFixed(2)} gr</div>
          <div className="text-xs text-slate-500 mt-1">
            Mavjud: <b>{availableGold.toFixed(2)}g</b> | Rezerv: <b>{reservedGold.toFixed(2)}g</b>
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border shadow-sm">
          <div className="text-xs font-bold text-amber-600">SOF OLTIN (999.9 EKVIVALENT)</div>
          <div className="text-xl font-black text-amber-700 mt-1">{fineGoldTotal.toFixed(4)} gr</div>
          <div className="text-xs text-slate-500 mt-1">NUMERIC(18,6) anacha aniqlikda</div>
        </div>
        <div className="bg-white p-4 rounded-2xl border shadow-sm">
          <div className="text-xs font-bold text-emerald-700">SOF KASSA BALANSI</div>
          <div className="text-xl font-black text-emerald-600 mt-1">
            {kassaNet.toLocaleString()} so&apos;m
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Kirim: +{kassaIn.toLocaleString()} | Chiqim: -{kassaOut.toLocaleString()}
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border shadow-sm">
          <div className="text-xs font-bold text-red-700">FAOL MIJOZLAR QARZI</div>
          <div className="text-xl font-black text-red-600 mt-1">
            {customerDebt.toLocaleString()} so&apos;m
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Qarz to&apos;lovlari: <b>{debtRepayments.length} ta</b>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="bg-white p-4 rounded-2xl border space-y-1.5 h-fit max-h-[70vh] overflow-y-auto">
          <div className="text-xs font-bold text-slate-500 px-2 pb-2 border-b">
            HISOBOT TURINI TANLANG (20)
          </div>
          {ERP_REPORT_TYPES.map((rep) => (
            <button
              key={rep}
              onClick={() => setSelectedReport(rep)}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition ${
                selectedReport === rep
                  ? "bg-blue-600 text-white shadow-sm"
                  : "hover:bg-slate-100 text-slate-700"
              }`}
            >
              {rep}
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 bg-white p-5 rounded-2xl border space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-3 border-b pb-3">
            <div>
              <h2 className="font-bold text-base text-slate-900">{selectedReport}</h2>
              <div className="text-xs text-slate-500">Jami qatorlar: {dataRows.length} ta</div>
            </div>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Jadval ichidan qidirish..."
              className="border rounded-xl px-3 py-1.5 text-xs w-64"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-100 border-b">
                  {headerRow.map((h, i) => (
                    <th key={i} className="p-2.5 font-bold text-slate-700">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={Math.max(1, headerRow.length)}
                      className="p-6 text-center text-slate-400"
                    >
                      Ushbu hisobot bo&apos;yicha hozircha ma&apos;lumot topilmadi.
                    </td>
                  </tr>
                ) : (
                  dataRows.map((row, rI) => (
                    <tr key={rI} className="border-b hover:bg-slate-50">
                      {row.map((c, cI) => (
                        <td key={cI} className="p-2.5">
                          {String(c ?? "-")}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
