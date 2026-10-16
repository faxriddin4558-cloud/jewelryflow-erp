"use client";

import * as React from "react";
import Link from "next/link";
import {
  supabase,
  type BatchRow,
  type BatchStageWipRow,
  type MachineRow,
} from "@/lib/erp-engine";
import {
  isDepartmentRouteActive,
  DEPARTMENT_ROUTE_CONFIG,
  type DepartmentRouteSlug,
} from "@/modules/manufacturing/presentation/config/departments.config";
import { getActiveFactoryConfig } from "@/lib/factory-config";
import { ShopfloorOperatorWorkspace, OwnerDashboard } from "@/components/manufacturing";
import {
  Layers,
  Scale,
  Cpu,
  ArrowRight,
  Tablet,
  LayoutGrid,
  CheckCircle2,
  AlertOctagon,
  Clock,
  BarChart3,
} from "lucide-react";

export default function ManufacturingHubPage() {
  const [activeTab, setActiveTab] = React.useState<"departments" | "touch" | "owner">("departments");
  const [batches, setBatches] = React.useState<BatchRow[]>([]);
  const [wipRows, setWipRows] = React.useState<BatchStageWipRow[]>([]);
  const [machines, setMachines] = React.useState<MachineRow[]>([]);
  const [pendingHandoversCount, setPendingHandoversCount] = React.useState<number>(0);
  const [loading, setLoading] = React.useState<boolean>(true);

  const factoryConfig = getActiveFactoryConfig();

  React.useEffect(() => {
    async function loadMetrics() {
      try {
        const [bRes, wRes, mRes, hRes] = await Promise.all([
          supabase.from("batches").select("*"),
          supabase.from("batch_stage_wip").select("*"),
          supabase.from("machines").select("*"),
          supabase
            .from("two_party_handovers")
            .select("id", { count: "exact", head: true })
            .eq("status", "PENDING_ACCEPTANCE"),
        ]);

        if (bRes.data) setBatches(bRes.data as BatchRow[]);
        if (wRes.data) setWipRows(wRes.data as BatchStageWipRow[]);
        if (mRes.data) setMachines(mRes.data as MachineRow[]);
        if (hRes.count != null) setPendingHandoversCount(hRes.count);
      } catch (err) {
        console.error("Failed to load manufacturing metrics:", err);
      } finally {
        setLoading(false);
      }
    }

    void loadMetrics();
  }, []);

  const totalWipGold = wipRows.reduce((acc, row) => acc + Number(row.input_weight || 0), 0);
  const activeBatchesCount = batches.filter((b) => b.status !== "COMPLETED" && b.status !== "Tugatildi").length;
  const activeMachinesCount = machines.filter((m) => m.status === "ACTIVE" || m.status === "OCCUPIED").length;

  const departmentRoutes = Object.entries(DEPARTMENT_ROUTE_CONFIG) as [
    DepartmentRouteSlug,
    { code: string; title: string }
  ][];

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <span>🏭</span> Ishlab Chiqarish va Sexlar Boshqaruvi
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Goldia zavodi bo&apos;limlari, konveyer navbati va operator planshet paneli
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1.5 rounded-xl border">
          <button
            onClick={() => setActiveTab("departments")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === "departments"
                ? "bg-white text-purple-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            <span>Sexlar Ro&apos;yxati ({departmentRoutes.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("touch")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === "touch"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Tablet className="w-4 h-4" />
            <span>📱 Operator Sensor Paneli</span>
          </button>
          <button
            onClick={() => setActiveTab("owner")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === "owner"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>📊 Rahbariyat Dashboardi</span>
          </button>
        </div>
      </div>

      {/* Top Level Metric Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>AKTIV PARTIYALAR</span>
            <Layers className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">
            {loading ? "..." : activeBatchesCount}
          </div>
          <div className="text-[11px] text-slate-400">Jarayondagi buyurtmalar</div>
        </div>

        <div className="bg-white p-4 rounded-xl border shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>JARAYONDAGI OLTIN</span>
            <Scale className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-amber-700">
            {loading ? "..." : `${totalWipGold.toFixed(2)} g`}
          </div>
          <div className="text-[11px] text-slate-400">Sexlar bo&apos;ylab aktiv WIP</div>
        </div>

        <div className="bg-white p-4 rounded-xl border shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>TOPSHIRISH KUTILMOQDA</span>
            <Clock className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-black text-rose-700">
            {loading ? "..." : pendingHandoversCount}
          </div>
          <div className="text-[11px] text-slate-400">Ikki tomonlama qabul navbati</div>
        </div>

        <div className="bg-white p-4 rounded-xl border shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>STANOKLAR</span>
            <Cpu className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-blue-700">
            {loading ? "..." : `${activeMachinesCount} ta`}
          </div>
          <div className="text-[11px] text-slate-400">Lazer &amp; quyish uskunalari</div>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === "departments" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-slate-900">
              Sexlar va Konveyer Bo&apos;limlari (Department Boards)
            </h2>
            <span className="text-xs text-slate-500">
              Goldia konfiguratsiyasi: <b>{factoryConfig.factoryName}</b>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {departmentRoutes.map(([slug, meta], idx) => {
              const isActive = isDepartmentRouteActive(slug, factoryConfig);
              const deptWip = wipRows.filter(
                (w) =>
                  w.department &&
                  (w.department.toLowerCase().includes(meta.title.toLowerCase()) ||
                    w.department.toLowerCase().includes(meta.code.toLowerCase()))
              );
              const deptPcs = deptWip.reduce((acc, r) => acc + Number(r.available_qty || 0), 0);

              return (
                <div
                  key={slug}
                  className={`bg-white rounded-2xl border p-4 flex flex-col justify-between transition-all hover:shadow-md ${
                    !isActive ? "opacity-60 bg-slate-50 border-dashed" : "border-slate-200"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <span className="text-[11px] font-mono text-slate-400 font-semibold">
                        #{idx + 1} • {meta.code}
                      </span>
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Aktiv
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                          <AlertOctagon className="w-2.5 h-2.5" /> Bypassed
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-base text-slate-900">{meta.title}</h3>

                    <div className="text-xs text-slate-500">
                      Navbatda: <b className="text-purple-700">{deptPcs} dona</b>
                    </div>
                  </div>

                  <div className="pt-4 mt-2 border-t">
                    <Link
                      href={`/manufacturing/${slug}`}
                      className={`w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-between transition-colors ${
                        isActive
                          ? "bg-slate-100 hover:bg-purple-600 hover:text-white text-slate-700"
                          : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                      }`}
                    >
                      <span>Bo&apos;lim Taxtasi</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "touch" && (
        <div className="space-y-4">
          <ShopfloorOperatorWorkspace />
        </div>
      )}

      {activeTab === "owner" && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                🏭 Zavod Rahbariyati Monitoring Dashboardi
              </h2>
              <p className="text-xs text-slate-500">
                Real vaqtdagi ishlab chiqarish yuklamasi, partiyalar oqimi va tarozi tekshiruvlari
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-purple-50 text-purple-700 rounded-lg border border-purple-200">
              Goldia Factory Live
            </span>
          </div>

          <OwnerDashboard
            stats={{
              activeBatches: activeBatchesCount,
              overdueStages: wipRows.filter(
                (w) => w.queue_status === "NOW" && Number(w.available_qty || 0) > 0
              ).length,
              machineLoadPercent:
                machines.length > 0
                  ? Math.round(
                      (machines.filter((m) => String(m.status || "").toUpperCase() === "BUSY").length /
                        machines.length) *
                        100
                    )
                  : 0,
              wipQuantityGrams: Number(totalWipGold.toFixed(2)),
              unresolvedGoldDiscrepancies: pendingHandoversCount,
              productionPerformanceScore: Number(
                Math.max(
                  1.0,
                  Math.min(
                    10.0,
                    10.0 -
                      wipRows.filter(
                        (w) => w.queue_status === "NOW" && Number(w.available_qty || 0) > 0
                      ).length *
                        0.4
                  )
                ).toFixed(1)
              ),
            }}
          />
        </div>
      )}
    </div>
  );
}
