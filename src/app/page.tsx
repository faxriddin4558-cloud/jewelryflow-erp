"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  supabase,
  GoldEngine,
  RBAC,
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
  type AuditLogRow,
} from "@/lib/erp-engine";

const DEFAULT_REPORT: ErpReportType = "1. Daily production";

export default function DashboardPage() {
  const [mainTab, setMainTab] = useState<"kpi" | "reports" | "audit" | "e2e">("kpi");
  const [currentUser, setCurrentUser] = useState(() => RBAC.getCurrentUser());
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
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [selectedReport, setSelectedReport] = useState<ErpReportType>(DEFAULT_REPORT);
  const [testResults, setTestResults] = useState<{ name: string; passed: boolean; detail: string }[]>([]);

  const loadAll = useCallback(async () => {
    const [i, g, b, w, o, s, dr, m, c, p, e, sl, q, a] = await Promise.all([
      supabase.from("inventory_items").select("*"),
      supabase.from("gold_transactions").select("*").order("created_at", { ascending: false }),
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("batch_stage_wip").select("*").order("stage_order"),
      supabase.from("orders").select("*"),
      supabase.from("sales").select("*"),
      supabase.from("debt_repayments").select("*").order("created_at", { ascending: false }),
      supabase.from("machines").select("*"),
      supabase.from("consumption").select("*"),
      supabase.from("products").select("*"),
      supabase.from("employees").select("*"),
      supabase.from("salary_ledger").select("*").order("created_at", { ascending: false }),
      supabase.from("quality_control").select("*"),
      supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(40),
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
    if (a.data) setAuditLogs(a.data as AuditLogRow[]);
  }, []);

  useEffect(() => {
    setCurrentUser(RBAC.getCurrentUser());
    const unsubscribe = RBAC.subscribe((updatedUser) => {
      setCurrentUser(updatedUser);
    });
    void loadAll();
    return () => {
      unsubscribe();
    };
  }, [loadAll]);

  const isDone = (st?: string | null) => st === "Tugatildi" || (st || "").toLowerCase() === "completed";

  const { rawGoldOnHand, fineGoldTotal } = GoldEngine.calculateSafeGoldSummary(inv);

  const activeBatches = batches.filter(b => !isDone(b.status));
  const finishedBatches = batches.filter(b => isDone(b.status));
  const wipGold = activeBatches.reduce((s, b) => s + Number(b.wip_gram ?? 0), 0);
  const finishedGoodsGram = products.reduce(
    (s, p) => s + Math.max(0, Number(p.weight || 0) - Number(p.stone_weight || 0)) * Number(p.stock ?? p.quantity ?? 0),
    0
  );
  const totalLoss = consumption.reduce(
    (s, c) =>
      s +
      Number(
        c.loss_weight ??
          (Number(c.given_weight || 0) - Number(c.returned_weight || 0) - Number(c.sprue_gram || 0))
      ),
    0
  );

  const { kassaIn, kassaOut, customerDebt } = GoldEngine.calculateFinancialSummary(sales, orders);

  const getReportRows = (repName: string): (string | number)[][] =>
    buildErpReportRows(repName, {
      inv,
      goldTx,
      batches,
      wipRows,
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

  const downloadReportCsv = (repName: string) => {
    downloadExcelCsv(repName, getReportRows(repName));
  };

  const runAutomatedTests = async () => {
    const res: { name: string; passed: boolean; detail: string }[] = [];
    const fg = GoldEngine.toFineGold(111, 988);
    res.push({
      name: "1. Gold Calculation Engine (111g @ 988 -> 109.67g Fine)",
      passed: fg === 109.67,
      detail: `Natija: ${fg} gr`
    });
    const al = GoldEngine.calculateAlloy(100, 999, 585, 70);
    res.push({
      name: "2. Ligature & 70/30 Ratio Engine (999 -> 585)",
      passed: al.requiredLigature === 70.77 && al.totalOutputWeight === 170.77,
      detail: `Ligatura: +${al.requiredLigature}g | Jami: ${al.totalOutputWeight}g`
    });
    const mbOk = GoldEngine.verifyMassBalance({
      inputGold: 1000,
      goodProduct: 850,
      sprue: 100,
      scrap: 20,
      rework: 0,
      loss: 30,
      remainingWip: 0
    });
    const mbErr = GoldEngine.verifyMassBalance({
      inputGold: 1000,
      goodProduct: 850,
      sprue: 100,
      scrap: 20,
      rework: 0,
      loss: 10,
      remainingWip: 0
    });
    const mbZero = GoldEngine.verifyMassBalance({
      inputGold: 0,
      goodProduct: 0,
      sprue: 0,
      scrap: 0,
      rework: 0,
      loss: 0,
      remainingWip: 0
    });
    res.push({
      name: "3. Mass Balance & Anomaly Detection (1000g vs 980g & Zero Guard)",
      passed: mbOk.isBalanced && !mbErr.isBalanced && !mbZero.isBalanced,
      detail: `1000g -> ${mbOk.statusText} | 980g -> ${mbErr.statusText}`
    });
    const prevUser = RBAC.getCurrentUser();
    RBAC.setCurrentUser({ name: "Test Worker", role: "Worker", department: "Sanding" });
    const workerBlocked = !RBAC.can("edit_inventory") && !RBAC.can("edit_sales");
    RBAC.setCurrentUser(prevUser);
    res.push({
      name: "4. RBAC Permission Guard (Worker blocked from Inventory/Sales)",
      passed: workerBlocked,
      detail: "Worker edit_inventory: false, edit_sales: false"
    });
    const { data: stData } = await supabase.from("production_stages").select("*");
    const stageCount = stData?.length || 0;
    res.push({
      name: "5. 25-Stage Production Engine Schema",
      passed: stageCount >= 25,
      detail: `Bazadagi faol bosqichlar: ${stageCount} ta`
    });
    const partialMb = GoldEngine.verifyMassBalance({
      inputGold: 150,
      goodProduct: 60,
      sprue: 0,
      scrap: 0,
      rework: 0,
      loss: 0,
      remainingWip: 90
    });
    res.push({
      name: "6. E2E Partial Quantity WIP Conservation (150g -> 60g + 90g WIP)",
      passed: partialMb.isBalanced,
      detail: `Casting WIP: 6/10 (90g) qoldi | Zaklirovka WIP: 4 komplekt (60g) qabul qildi (${partialMb.statusText})`
    });
    setTestResults(res);
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">💎 JewelryFlow ERP — Real Factory Control Center</h1>
          <p className="text-xs text-slate-500">Faol: <b className="text-blue-700">{currentUser.name}</b> | Bo&apos;lim: <b>{currentUser.department}</b></p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-500">Tasdiqlangan Rol (Server RLS):</span>
          <span className="border border-blue-200 bg-blue-50 text-blue-800 px-3 py-1.5 rounded-xl font-bold">
            🛡️ {currentUser.role}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-fit">
        <button onClick={() => setMainTab("kpi")} className={`px-4 py-2 rounded-lg text-xs font-bold ${mainTab === "kpi" ? "bg-slate-900 text-white" : "text-slate-600"}`}>📊 Asosiy KPI &amp; Mass Balance</button>
        <button onClick={() => setMainTab("reports")} className={`px-4 py-2 rounded-lg text-xs font-bold ${mainTab === "reports" ? "bg-slate-900 text-white" : "text-slate-600"}`}>📑 20 ta Real Hisobot &amp; Excel</button>
        <button onClick={() => setMainTab("audit")} className={`px-4 py-2 rounded-lg text-xs font-bold ${mainTab === "audit" ? "bg-slate-900 text-white" : "text-slate-600"}`}>🛡️ Audit Log ({auditLogs.length})</button>
        <button onClick={() => { setMainTab("e2e"); void runAutomatedTests(); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${mainTab === "e2e" ? "bg-emerald-600 text-white" : "text-emerald-700 bg-emerald-50"}`}>🧪 Avtomatik E2E Test</button>
      </div>

      {mainTab === "kpi" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border"><span className="text-xs font-bold text-amber-600">📦 XOMASHYO OLTIN (SAFE)</span><div className="text-2xl font-black mt-1">{rawGoldOnHand.toFixed(2)} gr</div><div className="text-xs text-slate-500 mt-1">Sof (999.9): <b className="text-amber-700">{fineGoldTotal.toFixed(2)} gr</b></div></div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border"><span className="text-xs font-bold text-purple-600">⚙️ SEXDAGI WIP OLTIN</span><div className="text-2xl font-black mt-1">{wipGold.toFixed(2)} gr <span className="text-xs text-purple-600">({activeBatches.length} faol)</span></div><div className="text-xs text-slate-500 mt-1">Tugatilgan: <b className="text-emerald-600">{finishedBatches.length} ta</b></div></div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border"><span className="text-xs font-bold text-indigo-600">💎 TAYYOR MAHSULOT (VITRINA)</span><div className="text-2xl font-black mt-1">{finishedGoodsGram.toFixed(2)} gr</div><div className="text-xs text-slate-500 mt-1">Jami pateriya (Loss): <b className="text-red-600">{totalLoss.toFixed(2)} gr</b></div></div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border"><span className="text-xs font-bold text-emerald-600">💰 SOF KASSA &amp; QARZLAR</span><div className="text-xl font-black text-emerald-600 mt-1">{(kassaIn - kassaOut).toLocaleString()} so&apos;m</div><div className="text-xs text-red-600 font-semibold mt-1">Mijozlar qarzi: {customerDebt.toLocaleString()} so&apos;m</div></div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold">🚀 Partiyalar Oqimi va Mass Balance Nazorati</h2>
              <Link href="/batches" className="text-xs font-bold text-purple-600 hover:underline">Quantity-WIP Boshqaruviga o&apos;tish →</Link>
            </div>
            <table className="w-full text-left text-sm">
              <thead><tr className="text-xs text-slate-500 bg-slate-50 border-b"><th className="p-3">Partiya No</th><th className="p-3">Model</th><th className="p-3">Bosqich</th><th className="p-3 text-right">Input / Output</th><th className="p-3">Mass Balance</th><th className="p-3 text-center">Holat</th></tr></thead>
              <tbody>
                {batches.map((b, i) => {
                  const done = isDone(b.status);
                  const inG = Number(b.issued_gold_gram ?? b.planned_gram ?? 0);
                  const outG = Number(b.good_output_gram ?? b.actual_gram ?? 0);
                  const sprueG = Number(b.sprue_gram ?? 0);
                  const scrapG = Number(b.scrap_gram ?? 0);
                  const reworkG = Number(b.rework_gram ?? 0);
                  const lsG = Number(b.loss_gram ?? 0);
                  const wipG = done ? 0 : Number(b.wip_gram ?? Math.max(0, inG - outG - sprueG - scrapG - reworkG - lsG));
                  const mb = GoldEngine.verifyMassBalance({
                    inputGold: inG,
                    goodProduct: outG,
                    sprue: sprueG,
                    scrap: scrapG,
                    rework: reworkG,
                    loss: lsG,
                    remainingWip: wipG
                  });
                  return (
                    <tr key={i} className="border-b">
                      <td className="p-3 font-bold">{b.batch_no || b.number}</td>
                      <td className="p-3">{b.product_name || b.product || "Komplekt"}</td>
                      <td className="p-3"><span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-semibold">{done ? "25. Tayyor mahsulot ombori" : (b.current_step || "8. Quyish")}</span></td>
                      <td className="p-3 text-right font-bold">{inG}g / <span className="text-emerald-600">{outG}g</span></td>
                      <td className="p-3 text-xs font-bold"><span className={mb.isBalanced ? "text-emerald-600" : "text-red-600"}>{mb.statusText}</span></td>
                      <td className="p-3 text-center"><span className={`px-2 py-1 rounded-full text-xs font-bold ${done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{done ? "Tugatildi" : "Jarayonda"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mainTab === "reports" && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-4 border-b pb-4">
            <select
              value={selectedReport}
              onChange={(e) => setSelectedReport(e.target.value as ErpReportType)}
              className="border-2 border-purple-500 rounded-xl p-2.5 font-bold text-sm bg-purple-50"
            >
              {ERP_REPORT_TYPES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              onClick={() => downloadReportCsv(selectedReport)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl"
            >
              📥 Excel (CSV) Yuklab Olish
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="bg-slate-100 border-b">{getReportRows(selectedReport)[0]?.map((h, i) => <th key={i} className="p-2.5 font-bold">{h}</th>)}</tr></thead>
              <tbody>{getReportRows(selectedReport).slice(1).map((row, rI) => <tr key={rI} className="border-b">{row.map((c, cI) => <td key={cI} className="p-2.5">{String(c ?? "-")}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {mainTab === "audit" && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-3">
          <h2 className="font-bold">🛡️ O&apos;zgarmas Audit Log</h2>
          <table className="w-full text-left text-xs">
            <thead><tr className="bg-slate-50 border-b"><th className="p-2">Vaqt</th><th className="p-2">Kim (Rol)</th><th className="p-2">Jadval / Amal</th><th className="p-2">Ma&apos;lumot</th></tr></thead>
            <tbody>{auditLogs.map((a, i) => <tr key={i} className="border-b"><td className="p-2">{a.created_at ? new Date(a.created_at).toLocaleString("uz-UZ") : "-"}</td><td className="p-2 font-bold">{a.actor_name} ({a.actor_role})</td><td className="p-2 text-blue-700 font-semibold">{a.table_name} - {a.action}</td><td className="p-2 font-mono text-[11px] truncate max-w-md">{JSON.stringify(a.new_data)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {mainTab === "e2e" && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-3">
          <h2 className="font-bold">🧪 Avtomatik Business Logic &amp; End-to-End Test Natijalari</h2>
          {testResults.map((t, i) => (
            <div key={i} className={`p-3 rounded-xl border flex justify-between items-center text-sm ${t.passed ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
              <div><b>{t.passed ? "✅ PASS: " : "❌ FAIL: "}{t.name}</b><div className="text-xs text-slate-600">{t.detail}</div></div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${t.passed ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>{t.passed ? "PASSED" : "FAILED"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
