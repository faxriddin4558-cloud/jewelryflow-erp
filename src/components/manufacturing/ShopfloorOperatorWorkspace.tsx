"use client";

import * as React from "react";
import {
  supabase,
  GoldEngine,
  RBAC,
  generateIdempotencyKey,
  type BatchRow,
  type ProductionStageRow,
  type BatchStageWipRow,
  type MachineRow,
  type EmployeeRow,
} from "@/lib/erp-engine";
import {
  isStageActive,
  getNextActiveStage,
  getActiveFactoryConfig,
} from "@/lib/factory-config";
import type { BatchStatus, BatchPriority, OperationStatus } from "@/shared/types/database.types";
import { OperatorTouchPanel } from "./OperatorTouchPanel";
import { BatchProgressCard } from "./BatchProgressCard";
import { StageQueueBoard, type QueueItem } from "./StageQueueBoard";
import { HandoverWeightForm } from "./HandoverWeightForm";
import { ManufacturingStatusBadge } from "./ManufacturingStatusBadge";
import { DEPARTMENT_ROUTE_CONFIG, type DepartmentRouteSlug } from "@/modules/manufacturing/presentation/config/departments.config";
import { RefreshCw, CheckCircle2, AlertOctagon, Scale, ShieldAlert } from "lucide-react";

interface HandoverRecord {
  id: string;
  batch_id: string;
  batch_no: string;
  from_stage_order: number;
  from_stage_name: string;
  from_department: string;
  to_stage_order: number;
  to_stage_name: string;
  to_department: string;
  sender_worker_id: string;
  sender_worker_name: string;
  receiver_worker_id: string | null;
  receiver_worker_name: string | null;
  dispatched_qty: number;
  dispatched_weight_gram: number;
  received_qty: number | null;
  received_weight_gram: number | null;
  weight_discrepancy_gram: number | null;
  status: string;
  tolerance_gram: number;
  flag_reason: string | null;
  supervisor_override_id: string | null;
  supervisor_override_reason: string | null;
  dispatched_at: string;
}

export interface ShopfloorOperatorWorkspaceProps {
  initialDepartment?: string;
  onRefresh?: () => void;
  className?: string;
}

function normalizeBatchStatus(status?: string | null): BatchStatus {
  if (!status) return "pending";
  const s = status.toLowerCase();
  if (s.includes("tugat") || s.includes("complet")) return "completed";
  if (s.includes("in_progress") || s.includes("jarayon")) return "in_progress";
  if (s.includes("queue") || s.includes("navbat")) return "queued";
  if (s.includes("delay") || s.includes("kechik")) return "delayed";
  if (s.includes("hold") || s.includes("to'xtat")) return "on_hold";
  if (s.includes("cancel") || s.includes("bekor")) return "cancelled";
  return "in_progress";
}

function normalizePriority(priority?: string | null): BatchPriority {
  if (!priority) return "normal";
  const p = priority.toLowerCase();
  if (p === "low" || p === "normal" || p === "high" || p === "urgent") return p as BatchPriority;
  if (p.includes("vip") || p.includes("urgent")) return "urgent";
  return "normal";
}

export function ShopfloorOperatorWorkspace({
  initialDepartment,
  className,
}: ShopfloorOperatorWorkspaceProps) {
  const [selectedDeptSlug, setSelectedDeptSlug] = React.useState<string>(initialDepartment || "casting");
  const [batches, setBatches] = React.useState<BatchRow[]>([]);
  const [stages, setStages] = React.useState<ProductionStageRow[]>([]);
  const [wipRows, setWipRows] = React.useState<BatchStageWipRow[]>([]);
  const [machines, setMachines] = React.useState<MachineRow[]>([]);
  const [handovers, setHandovers] = React.useState<HandoverRecord[]>([]);
  const [employees, setEmployees] = React.useState<EmployeeRow[]>([]);
  const [selectedBatch, setSelectedBatch] = React.useState<BatchRow | null>(null);

  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  // Form states for move/handover
  const [movePieces, setMovePieces] = React.useState<string>("1");
  const [sprueGram, setSprueGram] = React.useState<string>("0");
  const [scrapGram, setScrapGram] = React.useState<string>("0");
  const [lossGram, setLossGram] = React.useState<string>("0");

  // Handover receiver form state
  const [recvWeight, setRecvWeight] = React.useState<string>("");
  const [recvPieces, setRecvPieces] = React.useState<string>("");
  const [overrideReason, setOverrideReason] = React.useState<string>("");
  const [selectedPendingHandover, setSelectedPendingHandover] = React.useState<HandoverRecord | null>(null);

  const currentUser = RBAC.getCurrentUser();
  const factoryConfig = getActiveFactoryConfig();

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const [bRes, sRes, wRes, mRes, hRes, eRes] = await Promise.all([
        supabase.from("batches").select("*").order("created_at", { ascending: false }),
        supabase.from("production_stages").select("*").order("stage_order"),
        supabase.from("batch_stage_wip").select("*").order("stage_order"),
        supabase.from("machines").select("*").order("name"),
        supabase.from("two_party_handovers").select("*").order("dispatched_at", { ascending: false }).limit(50),
        supabase.from("employees").select("*"),
      ]);

      if (bRes.error) throw bRes.error;
      if (sRes.error) throw sRes.error;

      const loadedBatches = (bRes.data || []) as BatchRow[];
      setBatches(loadedBatches);
      setStages((sRes.data || []) as ProductionStageRow[]);
      setWipRows((wRes.data || []) as BatchStageWipRow[]);
      setMachines((mRes.data || []) as MachineRow[]);
      setHandovers((hRes.data || []) as HandoverRecord[]);
      setEmployees((eRes.data || []) as EmployeeRow[]);

      if (loadedBatches.length > 0 && !selectedBatch) {
        setSelectedBatch(loadedBatches[0] ?? null);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load manufacturing shopfloor data.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBatch]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  // Resolve current active stage based on department route slug
  const currentDeptConfig = DEPARTMENT_ROUTE_CONFIG[selectedDeptSlug as DepartmentRouteSlug] || {
    code: "CASTING",
    title: "Casting",
  };

  const currentStage = stages.find((s) => {
    const sName = (s.name || "").toLowerCase();
    const deptTitle = currentDeptConfig.title.toLowerCase();
    const deptCode = currentDeptConfig.code.toLowerCase();
    return sName.includes(deptTitle) || sName.includes(deptCode) || (s.department || "").toLowerCase().includes(deptTitle);
  }) || stages[0];

  const currentStageOrder = currentStage?.stage_order ?? 8;
  const isCurrentStageBypassed = currentStage ? !isStageActive(currentStage, factoryConfig) : false;

  // Department machine
  const deptMachines = machines.filter((m) => {
    const mDept = (m.department || "").toLowerCase();
    return mDept.includes(currentDeptConfig.title.toLowerCase()) || mDept.includes(currentDeptConfig.code.toLowerCase());
  });
  const currentMachine = deptMachines[0] || machines[0];
  const isMachineOccupied = currentMachine ? currentMachine.status === "OCCUPIED" || currentMachine.status === "in_use" : false;

  // Filter WIP for this stage
  const stageWipList = wipRows.filter((w) => w.stage_order === currentStageOrder && Number(w.available_qty ?? 0) > 0);

  // Queue items for StageQueueBoard
  const queueItems: QueueItem[] = stageWipList.map((wip) => {
    const parentBatch = batches.find((b) => (b.batch_no || b.number) === wip.batch_no);
    return {
      id: wip.id || `${wip.batch_no}-${wip.stage_order}`,
      batchNumber: wip.batch_no || "BATCH",
      priority: normalizePriority(parentBatch?.priority),
      status: (wip.queue_status === "WORKING" ? "in_progress" : "queued") as OperationStatus,
      assignedTo: wip.assigned_worker || parentBatch?.master_name,
      queuedAt: parentBatch?.created_at,
    };
  });

  const activeQueueItem = queueItems.find((q) => q.status === "in_progress") || queueItems[0];

  // Handovers pending acceptance for this department
  const pendingHandoversForThisDept = handovers.filter((h) => {
    return (
      (h.status === "PENDING_ACCEPTANCE" || h.status === "DISCREPANCY_FLAGGED") &&
      (h.to_stage_order === currentStageOrder ||
        (h.to_department && h.to_department.toLowerCase().includes(currentDeptConfig.title.toLowerCase())))
    );
  });

  // Handle stage completion & handover dispatch
  const handleHandoverSubmit = async (formData: { inputWeight: number; outputWeight: number; notes: string }) => {
    if (!selectedBatch) {
      alert("Iltimos, avval partiyani tanlang!");
      return;
    }

    const bCode = selectedBatch.batch_no || selectedBatch.number || "";
    const activeWip = wipRows.find((w) => w.batch_no === bCode && w.stage_order === currentStageOrder);
    const availablePcs = Number(activeWip?.available_qty ?? selectedBatch.planned_qty ?? 0);
    const qMove = parseInt(movePieces, 10) || 1;

    if (qMove <= 0 || qMove > availablePcs) {
      alert(`Xato: Kiritilgan komplekt soni (${qMove}) mavjud (${availablePcs}) dan oshmasligi kerak!`);
      return;
    }

    const gSprue = parseFloat(sprueGram) || 0;
    const gScrap = parseFloat(scrapGram) || 0;
    const gLoss = parseFloat(lossGram) || 0;
    const gOutput = formData.outputWeight;

    const nextSt = getNextActiveStage(currentStageOrder, stages, factoryConfig);

    let isExcessLossConfirmed = false;
    let excessLossReason: string | null = null;

    if (gLoss > 0) {
      const lossCheck = GoldEngine.validateStageLoss({
        inputWeightGram: gOutput + gLoss + gSprue + gScrap,
        lossWeightGram: gLoss,
        stageName: currentStage?.name,
      });

      if (!lossCheck.isAcceptable) {
        if (!RBAC.can("approve_loss_override") && !RBAC.can("manage_settings")) {
          alert(
            `RUXSAT ETILMADI: Ushbu bosqichda yo'qotish (+${lossCheck.excessLossGram.toFixed(2)}g) me'yordan oshdi. Faqat supervayzer yoki menejer tasdiqlay oladi.`
          );
          return;
        }
        const confirmLoss = window.confirm(
          `DIQQAT (ME'YORDAN ORTIQ YO'QOTISH):\n` +
          `Kiritilgan pateriya: ${gLoss.toFixed(2)}g (${lossCheck.lossPct.toFixed(2)}%)\n` +
          `Ruxsat etilgan me'yor: ${lossCheck.maxLossPct}% (maks ${lossCheck.maxLossGram}g)\n` +
          `Tasdiqlaysizmi? Bu audit jurnaliga kiritiladi.`
        );
        if (!confirmLoss) return;
        isExcessLossConfirmed = true;
        excessLossReason = `Operator/Rahbar tasdiqladi: ${formData.notes || "Belgilangan me'yordan ortiq yo'qotish"}`;
      }
    }

    setIsSubmitting(true);
    setSuccessMsg(null);
    try {
      const currentEmp = employees.find((e) => (e.name || e.full_name) === currentUser.name);

      // Call atomic partial WIP move RPC
      const { error: moveErr } = await supabase.rpc("rpc_move_partial_wip", {
        p_batch_id: selectedBatch.id != null ? String(selectedBatch.id) : null,
        p_from_stage_order: currentStageOrder,
        p_to_stage_order: nextSt.stage_order,
        p_to_stage_name: nextSt.name,
        p_to_department: nextSt.department || "Sex",
        p_move_qty: qMove,
        p_move_weight: gOutput,
        p_move_gram: gOutput,
        p_rework_qty: 0,
        p_sprue_gram: gSprue,
        p_scrap_gram: gScrap,
        p_loss_gram: gLoss,
        p_worker_name: currentUser.name,
        p_worker_id: currentEmp?.id != null ? String(currentEmp.id) : null,
        p_idempotency_key: generateIdempotencyKey("shopfloor-wip"),
        p_allow_excess_loss: isExcessLossConfirmed,
        p_excess_loss_reason: excessLossReason,
      });

      if (moveErr) throw moveErr;

      // Register two-party handover for next department
      await supabase.rpc("rpc_dispatch_stage_handover", {
        p_batch_id: selectedBatch.id != null ? String(selectedBatch.id) : bCode,
        p_batch_no: bCode,
        p_from_stage_order: currentStageOrder,
        p_from_stage_name: currentStage?.name || `Bosqich ${currentStageOrder}`,
        p_from_department: currentDeptConfig.title,
        p_to_stage_order: nextSt.stage_order,
        p_to_stage_name: nextSt.name,
        p_to_department: nextSt.department || "Sex",
        p_sender_worker_id: currentEmp?.id != null ? String(currentEmp.id) : "emp-operator",
        p_sender_worker_name: currentUser.name,
        p_dispatched_qty: qMove,
        p_dispatched_weight_gram: gOutput,
        p_tolerance_gram: 0.05,
        p_idempotency_key: generateIdempotencyKey("shopfloor-ho-disp"),
      });

      setSuccessMsg(
        `Muvaffaqiyatli topshirildi: ${qMove} dona (${gOutput}g) -> ${nextSt.name}. Qabul qiluvchi bo'lim tasdiqlashiga yuborildi.`
      );
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Topshirishda xatolik yuz berdi.";
      alert(`Topshirish rad etildi: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Accept incoming handover
  const handleAcceptHandover = async (h: HandoverRecord) => {
    const rQty = parseInt(recvPieces, 10) || h.dispatched_qty;
    const rWeight = parseFloat(recvWeight) || h.dispatched_weight_gram;

    if (rQty <= 0 || rWeight <= 0) {
      alert("Haqiqiy tarozida tortilgan vazn va sonni to'g'ri kiriting!");
      return;
    }

    setIsSubmitting(true);
    try {
      const currentEmp = employees.find((e) => (e.name || e.full_name) === currentUser.name);
      const { data, error: hoErr } = await supabase.rpc("rpc_accept_stage_handover", {
        p_handover_id: h.id,
        p_receiver_worker_id: currentEmp?.id != null ? String(currentEmp.id) : "rec-worker",
        p_receiver_worker_name: currentUser.name,
        p_received_qty: rQty,
        p_received_weight_gram: rWeight,
        p_idempotency_key: generateIdempotencyKey("accept-shopfloor-ho"),
      });

      if (hoErr) throw hoErr;

      const res = data as { status?: string; discrepancy_gram?: number };
      if (res?.status === "DISCREPANCY_FLAGGED") {
        alert(
          `DIQQAT: Tarozida farq aniqlandi (+${res.discrepancy_gram ?? 0}g)! Ruxsat etilgan tolerantlik (${h.tolerance_gram}g) oshgani sababli muzlatildi. Supervayzer tasdiqlashi lozim.`
        );
      } else {
        setSuccessMsg(`Partiya muvaffaqiyatli qabul qilindi va navbatga olindi.`);
      }

      setSelectedPendingHandover(null);
      setRecvWeight("");
      setRecvPieces("");
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Qabul qilishda xatolik.";
      alert(`Qabul qilib bo'lmadi: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Supervisor override for flagged handovers
  const handleSupervisorOverride = async (h: HandoverRecord) => {
    const reason = overrideReason.trim();
    if (reason.length < 5) {
      alert("Supervayzer tekshiruv sababini kamida 5 ta belgi bilan yozishi shart!");
      return;
    }

    setIsSubmitting(true);
    try {
      const currentEmp = employees.find((e) => (e.name || e.full_name) === currentUser.name);
      const { error: ovErr } = await supabase.rpc("rpc_override_stage_handover", {
        p_handover_id: h.id,
        p_supervisor_worker_id: currentEmp?.id != null ? String(currentEmp.id) : "supervisor",
        p_supervisor_worker_name: currentUser.name,
        p_override_reason: reason,
        p_idempotency_key: generateIdempotencyKey("override-shopfloor-ho"),
      });

      if (ovErr) throw ovErr;

      setSuccessMsg(`Nomutanosiblik supervayzer tomonidan rasmiy tasdiqlandi.`);
      setSelectedPendingHandover(null);
      setOverrideReason("");
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Tasdiqlashda xatolik.";
      alert(`Supervayzer override xatosi: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <OperatorTouchPanel
      title={`🏭 ${currentDeptConfig.title} — Shopfloor Operator Touch Panel`}
      description="Factory plansheti va sensorli ekranlar uchun tezkor operatsion panel"
      isLoading={isLoading}
      error={error}
      className={className}
    >
      <div className="flex flex-col gap-6">
        {/* Department Selector Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-3 rounded-xl border">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Bo&apos;lim (Department):</span>
            <select
              value={selectedDeptSlug}
              onChange={(e) => {
                setSelectedDeptSlug(e.target.value);
                setSuccessMsg(null);
              }}
              className="bg-background border rounded-lg px-3 py-2 text-sm font-semibold text-foreground focus:ring-2 focus:ring-primary shadow-sm"
            >
              {(Object.keys(DEPARTMENT_ROUTE_CONFIG) as DepartmentRouteSlug[]).map((slug) => {
                const conf = DEPARTMENT_ROUTE_CONFIG[slug];
                const matchedStage = stages.find((s) => (s.name || "").toLowerCase().includes(conf.title.toLowerCase()));
                const bypassed = matchedStage ? !isStageActive(matchedStage, factoryConfig) : false;
                return (
                  <option key={slug} value={slug}>
                    {conf.title} {bypassed ? "(Bypassed / Goldia o'chirilgan)" : ""}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="flex items-center gap-2">
            {isCurrentStageBypassed && (
              <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 flex items-center gap-1 border border-amber-300">
                <AlertOctagon className="w-3.5 h-3.5" /> Goldia: Bosqich chetlab o&apos;tiladi (Bypass)
              </span>
            )}

            <button
              onClick={() => void loadData()}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg border text-xs font-medium bg-background hover:bg-muted flex items-center gap-1.5 transition-colors"
              title="Yangilash"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Yangilash
            </button>
          </div>
        </div>

        {/* Success Alert */}
        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl text-sm font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Incoming Two-Party Handovers Waiting for this Department */}
        {pendingHandoversForThisDept.length > 0 && (
          <div className="bg-amber-50/80 dark:bg-amber-950/20 border-2 border-amber-400/60 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
                <Scale className="w-5 h-5 text-amber-600" />
                Qabul qilinishi kutilayotgan partiyalar ({pendingHandoversForThisDept.length} ta)
              </h3>
              <span className="text-xs text-amber-700 dark:text-amber-300 font-semibold">
                Mustaqil tarozida tortish talab qilinadi
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pendingHandoversForThisDept.map((h) => {
                const isSelected = selectedPendingHandover?.id === h.id;
                const isFlagged = h.status === "DISCREPANCY_FLAGGED";

                return (
                  <div
                    key={h.id}
                    className={`p-3 rounded-lg border transition-all ${
                      isSelected
                        ? "bg-background border-primary shadow-md"
                        : "bg-background/80 hover:bg-background border-amber-200"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono font-bold text-sm text-purple-700">{h.batch_no}</span>
                        <div className="text-xs text-muted-foreground">
                          Yubordi: {h.sender_worker_name} ({h.from_stage_name})
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-sm text-foreground">
                          {h.dispatched_qty} dona / {Number(h.dispatched_weight_gram).toFixed(2)}g
                        </span>
                        {isFlagged && (
                          <div className="text-[10px] text-destructive font-bold flex items-center gap-1 justify-end">
                            <ShieldAlert className="w-3 h-3" /> Nomuvofiq (+{h.weight_discrepancy_gram}g)
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setSelectedPendingHandover(isSelected ? null : h);
                          setRecvPieces(String(h.dispatched_qty));
                          setRecvWeight(String(h.dispatched_weight_gram));
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {isSelected ? "Yopish" : isFlagged ? "Supervayzer Tasdiqlash" : "Qabul qilish"}
                      </button>
                    </div>

                    {/* Expandable Receive Form */}
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t space-y-3 bg-muted/30 p-3 rounded-md">
                        {!isFlagged ? (
                          <>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <label className="font-semibold text-muted-foreground">O&apos;lchangan vazn (g):</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={recvWeight}
                                  onChange={(e) => setRecvWeight(e.target.value)}
                                  className="w-full border rounded px-2 py-1.5 font-mono font-bold text-base bg-background"
                                />
                              </div>
                              <div>
                                <label className="font-semibold text-muted-foreground">Dona soni:</label>
                                <input
                                  type="number"
                                  value={recvPieces}
                                  onChange={(e) => setRecvPieces(e.target.value)}
                                  className="w-full border rounded px-2 py-1.5 font-bold text-base bg-background"
                                />
                              </div>
                            </div>
                            <button
                              onClick={() => void handleAcceptHandover(h)}
                              disabled={isSubmitting}
                              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs"
                            >
                              {isSubmitting ? "Tasdiqlanmoqda..." : "✓ Tarozida tortib qabul qilish"}
                            </button>
                          </>
                        ) : (
                          <div className="space-y-2">
                            <label className="text-xs font-semibold text-destructive">
                              Supervayzer tekshiruv sababi (majburiy):
                            </label>
                            <input
                              type="text"
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="Sabab va mas'ul rahbar xulosasi..."
                              className="w-full border rounded px-2 py-1.5 text-xs bg-background"
                            />
                            <button
                              onClick={() => void handleSupervisorOverride(h)}
                              disabled={isSubmitting}
                              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs"
                            >
                              {isSubmitting ? "Tasdiqlanmoqda..." : "Supervayzer Override Tasdiqlash"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Main Grid: Left Queue Board, Right Batch & Handover Form */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left: Stage Queue Board */}
          <div className="space-y-4">
            <StageQueueBoard
              stageName={currentDeptConfig.title}
              machineOccupied={isMachineOccupied}
              activeItem={activeQueueItem}
              queueItems={queueItems}
            />

            {/* Quick Batch Selection Cards */}
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Ushbu bo&apos;limdagi partiyalar ({stageWipList.length})
              </span>
              <div className="grid grid-cols-2 gap-2">
                {stageWipList.length === 0 ? (
                  <div className="col-span-2 text-center p-4 border border-dashed rounded-lg text-muted-foreground text-xs">
                    Bu bo&apos;limda hozircha partiya yo&apos;q
                  </div>
                ) : (
                  stageWipList.map((wip, i) => {
                    const parent = batches.find((b) => (b.batch_no || b.number) === wip.batch_no);
                    const isSel = (selectedBatch?.batch_no || selectedBatch?.number) === wip.batch_no;
                    return (
                      <div
                        key={i}
                        onClick={() => parent && setSelectedBatch(parent)}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          isSel
                            ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                            : "bg-card hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-mono font-bold text-xs">{wip.batch_no}</span>
                          <ManufacturingStatusBadge
                            type="batch"
                            status={normalizeBatchStatus(parent?.status)}
                            className="scale-90"
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          {parent?.product_name || parent?.product || "Zargarlik buyumi"}
                        </div>
                        <div className="text-xs font-semibold text-primary mt-1">
                          {wip.available_qty} dona ({wip.input_weight ?? 0}g)
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right: Selected Batch Progress Card and Complete & Handover Form */}
          <div className="space-y-6">
            <BatchProgressCard
              batchNumber={selectedBatch?.batch_no || selectedBatch?.number}
              status={normalizeBatchStatus(selectedBatch?.status)}
              priority={normalizePriority(selectedBatch?.priority)}
              currentStage={currentDeptConfig.title}
              department={currentDeptConfig.title}
              dueDate={selectedBatch?.deadline}
            />

            {selectedBatch && (
              <div className="space-y-4">
                {/* Handover and Partial Move Form */}
                <div className="bg-card border rounded-xl p-4 md:p-6 shadow-sm space-y-4">
                  <div className="flex justify-between items-center border-b pb-3">
                    <h3 className="font-bold text-base md:text-lg">
                      Topshirish / Keyingi bosqichga uzatish (Handover)
                    </h3>
                    <span className="text-xs font-semibold text-muted-foreground">
                      Keyingi: <b>{getNextActiveStage(currentStageOrder, stages, factoryConfig).name}</b>
                    </span>
                  </div>

                  {/* Quantity and Recovered Scrap/Sprue Inputs */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <label className="font-bold text-muted-foreground">Komplekt soni</label>
                      <input
                        type="number"
                        min="1"
                        value={movePieces}
                        onChange={(e) => setMovePieces(e.target.value)}
                        className="w-full border rounded-lg p-2 font-bold text-base bg-background mt-1"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-amber-700">Sprue / Qoldiq (g)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={sprueGram}
                        onChange={(e) => setSprueGram(e.target.value)}
                        className="w-full border rounded-lg p-2 bg-background mt-1"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-rose-600">Scrap / Qirindi (g)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={scrapGram}
                        onChange={(e) => setScrapGram(e.target.value)}
                        className="w-full border rounded-lg p-2 bg-background mt-1"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-destructive">Pateriya / Loss (g)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={lossGram}
                        onChange={(e) => setLossGram(e.target.value)}
                        className="w-full border rounded-lg p-2 bg-background mt-1 font-bold"
                      />
                    </div>
                  </div>

                  {/* Integrated HandoverWeightForm from Jules */}
                  <HandoverWeightForm
                    batchNumber={selectedBatch.batch_no || selectedBatch.number || "BATCH"}
                    expectedInputWeight={Number(selectedBatch.issued_gold_gram ?? selectedBatch.planned_gram ?? 0)}
                    maxLossThreshold={0.5}
                    isSubmitting={isSubmitting}
                    onSubmit={handleHandoverSubmit}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </OperatorTouchPanel>
  );
}
