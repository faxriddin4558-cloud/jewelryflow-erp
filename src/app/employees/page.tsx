"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase,
  RBAC,
  logErpAudit,
  generateIdempotencyKey,
  type EmployeeRow,
  type SalaryLedgerRow,
  type BatchStageWipRow,
  type BatchRow,
  type ProductionStageRow,
} from "@/lib/erp-engine";
import { PieceworkDashboard } from "@/components/manufacturing";
import { usePiecework } from "@/hooks/manufacturing";

export default function EmployeesPage() {
  const [tab, setTab] = useState<"salary" | "piecework" | "supervisor">("salary");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [ledger, setLedger] = useState<SalaryLedgerRow[]>([]);
  const [wipTasks, setWipTasks] = useState<BatchStageWipRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [stages, setStages] = useState<ProductionStageRow[]>([]);
  const [selEmpId, setSelEmpId] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [stageName, setStageName] = useState("8. Quyish (Casting)");
  const [txType, setTxType] = useState<"EARNED" | "PAID">("EARNED");
  const [gramDone, setGramDone] = useState("50");
  const [rate, setRate] = useState("15000");
  const [amount, setAmount] = useState("750000");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const { data: pieceworkData, isLoading: isLoadingPiecework } = usePiecework(selEmpId);

  const load = useCallback(async () => {
    const [e, l, w, b, st] = await Promise.all([
      supabase.from("employees").select("*"),
      supabase.from("salary_ledger").select("*").order("created_at", { ascending: false }),
      supabase.from("batch_stage_wip").select("*").gt("available_qty", 0),
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("production_stages").select("*").order("stage_order"),
    ]);
    if (e.data) {
      const empList = e.data as EmployeeRow[];
      setEmployees(empList);
      if (!selEmpId && empList.length > 0 && empList[0]?.id) {
        setSelEmpId(String(empList[0].id));
        if (Number(empList[0].rate ?? 0) > 0) {
          const empRate = Number(empList[0].rate);
          setRate(String(empRate));
          setAmount(String((parseFloat(gramDone) || 0) * empRate));
        }
      }
    }
    if (l.data) setLedger(l.data as SalaryLedgerRow[]);
    if (w.data) setWipTasks(w.data as BatchStageWipRow[]);
    if (b.data) {
      const bList = b.data as BatchRow[];
      setBatches(bList);
      if (!batchNo && bList.length > 0) {
        const firstBatchCode = bList[0]?.batch_no || bList[0]?.number;
        if (firstBatchCode) setBatchNo(firstBatchCode);
      }
    }
    if (st.data) setStages(st.data as ProductionStageRow[]);
  }, [selEmpId, batchNo, gramDone]);

  useEffect(() => {
    void load();
  }, [load]);

  // 19-BAND: ATOMIK ISH HAQI VA DUPLICATE SALARY GUARD
  const recordSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!RBAC.can("edit_salary_rate")) {
      alert("Ruxsat yo'q! Faqat Accountant yoki Director ish haqi yoza oladi.");
      return;
    }
    const sum = parseFloat(amount) || 0;
    const gramNum = parseFloat(gramDone) || 0;
    const rateNum = parseFloat(rate) || 0;
    if (sum <= 0 || gramNum < 0 || rateNum < 0) {
      alert("Summa 0 dan katta bo'lishi shart!");
      return;
    }

    const empObj = employees.find((x) => String(x.id) === selEmpId || (x.name || x.full_name) === selEmpId);
    if (!empObj || !empObj.id) {
      alert("XATO: Xodimlar ro'yxatidan haqiqiy xodimni tanlang!");
      return;
    }
    const empName = empObj.name || empObj.full_name || "Xodim";
    const cleanBatchNo = batchNo.trim() || "TO'LOV";

    if (txType === "EARNED") {
      if (!batchNo.trim()) {
        alert("Ish haqi hisoblash (EARNED) uchun partiya raqamini tanlang yoki kiriting!");
        return;
      }
      const dup = ledger.find(
        (x) =>
          (x.employee_id === empObj.id || x.worker_name === empName) &&
          x.batch_no === cleanBatchNo &&
          x.stage_name === stageName &&
          x.tx_type === "EARNED"
      );
      if (dup) {
        alert(
          `XATO (Duplicate Salary Guard): ${empName} uchun ${cleanBatchNo} partiyaning "${stageName}" bosqichiga ish haqi allaqachon yozilgan!`
        );
        return;
      }
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("salary");
      const { error } = await supabase.rpc("rpc_record_salary_transaction", {
        p_employee_id: empObj.id != null ? String(empObj.id) : null,
        p_worker_name: empName,
        p_batch_no: cleanBatchNo,
        p_stage_name: stageName,
        p_tx_type: txType,
        p_weight_done: gramNum,
        p_rate: rateNum,
        p_amount: sum,
        p_note: `${cleanBatchNo} - ${stageName}`,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik ish haqi amaliyoti rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_record_salary_transaction funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "salary_ledger",
        recordId: cleanBatchNo,
        action: `SALARY_${txType}`,
        newData: { employeeId: empObj.id, empName, batchNo: cleanBatchNo, stageName, sum },
      });
      alert("Ish haqi va xodim balansi atomik tarzda yangilandi!");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">
          Xodimlar, Ish Haqi (Duplicate Guard) &amp; Supervisor Sex Paneli
        </h1>
        <div className="flex gap-2 bg-slate-100 p-1.5 rounded-xl border">
          <button
            onClick={() => setTab("salary")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "salary" ? "bg-blue-600 text-white" : ""
            }`}
          >
            💰 Ish haqi &amp; Jamoa
          </button>
          <button
            onClick={() => setTab("piecework")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "piecework" ? "bg-blue-600 text-white" : ""
            }`}
          >
            🏷️ Ishbay Oylik (Piecework)
          </button>
          <button
            onClick={() => setTab("supervisor")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "supervisor" ? "bg-blue-600 text-white" : ""
            }`}
          >
            🛡️ Supervisor: WHO IS WORKING ON WHAT
          </button>
        </div>
      </div>

      {tab === "salary" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={(e) => void recordSalary(e)}
            className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit"
          >
            <h2 className="font-bold border-b pb-2">
              Ish haqi yozish (Atomik + Ikki marta yozishdan himoyalangan)
            </h2>
            <select
              value={selEmpId}
              onChange={(e) => {
                const val = e.target.value;
                setSelEmpId(val);
                const matched = employees.find(
                  (x) => String(x.id) === val || (x.name || x.full_name) === val
                );
                if (matched && Number(matched.rate ?? 0) > 0) {
                  const empRate = Number(matched.rate);
                  setRate(String(empRate));
                  setAmount(String((parseFloat(gramDone) || 0) * empRate));
                }
              }}
              className="w-full border rounded-xl p-2 bg-white font-bold"
            >
              <option value="">-- Xodimni tanlang --</option>
              {employees.map((em, i) => (
                <option key={em.id || i} value={em.id || em.name || em.full_name}>
                  {em.name || em.full_name} ({em.department || "Sex"})
                </option>
              ))}
            </select>
            <select
              value={txType}
              onChange={(e) => setTxType(e.target.value as "EARNED" | "PAID")}
              className="w-full border rounded-xl p-2 bg-white font-bold"
            >
              <option value="EARNED">➕ Ish haqi hisoblash (UNPAID)</option>
              <option value="PAID">➖ To&apos;lov berish (PAID)</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <input
                  list="sal-batch-list"
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value)}
                  placeholder="Partiya raqami"
                  className="w-full border rounded-xl p-2 font-bold"
                />
                <datalist id="sal-batch-list">
                  {batches.map((b, idx) => {
                    const bCode = b.batch_no || b.number;
                    return bCode ? <option key={idx} value={bCode} /> : null;
                  })}
                </datalist>
              </div>
              <div>
                <input
                  list="sal-stage-list"
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  placeholder="Bosqich"
                  className="w-full border rounded-xl p-2"
                />
                <datalist id="sal-stage-list">
                  {stages.map((st, idx) => (
                    <option key={idx} value={st.name} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500">Ishlangan (gr)</label>
                <input
                  type="number"
                  value={gramDone}
                  onChange={(e) => {
                    setGramDone(e.target.value);
                    setAmount(String((parseFloat(e.target.value) || 0) * (parseFloat(rate) || 0)));
                  }}
                  className="w-full border rounded-xl p-2 font-bold"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Stavka (so&apos;m)</label>
                <input
                  type="number"
                  value={rate}
                  onChange={(e) => {
                    setRate(e.target.value);
                    setAmount(
                      String((parseFloat(gramDone) || 0) * (parseFloat(e.target.value) || 0))
                    );
                  }}
                  className="w-full border rounded-xl p-2 font-bold"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500">Jami Summa (so&apos;m)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border rounded-xl p-2 font-black text-emerald-700"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-xl"
            >
              Tasdiqlash
            </button>
          </form>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-5 rounded-2xl border space-y-4">
              {employees.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pb-3 border-b">
                  {employees.map((em, idx) => (
                    <div key={em.id || idx} className="bg-slate-50 p-2.5 rounded-xl border text-xs">
                      <div className="font-bold text-slate-800 truncate">
                        {em.name || em.full_name}
                      </div>
                      <div className="text-slate-500 text-[11px]">{em.department || "Sex"}</div>
                      <div
                        className={`font-black mt-1 ${
                          Number(em.balance ?? 0) >= 0 ? "text-emerald-700" : "text-red-600"
                        }`}
                      >
                        Balans: {Number(em.balance ?? 0).toLocaleString()} so&apos;m
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <h3 className="font-bold mb-3">
                Xodimlar Balansi va Salary Ledger (PAID / UNPAID)
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="p-2">Sana</th>
                    <th className="p-2">Xodim</th>
                    <th className="p-2">Partiya / Bosqich</th>
                    <th className="p-2 text-right">Summa</th>
                    <th className="p-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((l, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2">
                        {l.created_at ? new Date(l.created_at).toLocaleDateString("uz-UZ") : "-"}
                      </td>
                      <td className="p-2 font-bold">{l.worker_name}</td>
                      <td className="p-2">
                        {l.batch_no} — {l.stage_name} ({l.weight_done}g)
                      </td>
                      <td className="p-2 text-right font-bold">
                        {Number(l.amount ?? 0).toLocaleString()} so&apos;m
                      </td>
                      <td className="p-2 text-center">
                        <span
                          className={`px-2 py-0.5 rounded font-bold ${
                            l.payment_status === "PAID"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {l.payment_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === "piecework" ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border">
            <div className="flex items-center gap-3">
              <label className="text-sm font-bold text-slate-700">Xodimni tanlang:</label>
              <select
                value={selEmpId}
                onChange={(e) => setSelEmpId(e.target.value)}
                className="border rounded-xl p-2 bg-white font-bold text-sm min-w-[220px]"
              >
                <option value="">-- Joriy / Birinchi xodim --</option>
                {employees.map((em, i) => (
                  <option key={em.id || i} value={String(em.id || em.name || em.full_name)}>
                    {em.name || em.full_name} ({em.department || "Sex"})
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-slate-500 font-medium">
              ℹ️ Real vaqtda topshirilgan bosqichlar va maosh daftari hisob-kitobi
            </div>
          </div>

          <PieceworkDashboard
            employeeName={pieceworkData?.employeeName || "Xodim"}
            employmentStatus={pieceworkData?.employmentStatus || "active"}
            stats={
              pieceworkData?.stats || {
                acceptedPieces: 0,
                pendingPieces: 0,
                earnedAmount: 0,
                currency: "UZS",
              }
            }
            adjustments={pieceworkData?.adjustments || []}
            isLoading={isLoadingPiecework}
          />
        </div>
      ) : (
        <div className="bg-white p-6 rounded-2xl border space-y-4">
          <h2 className="text-lg font-bold">
            🛡️ Supervisor Paneli: WHO IS WORKING ON WHAT (Real-Time Sex Taqsimoti)
          </h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 border-b">
                <th className="p-3">Usta (Worker)</th>
                <th className="p-3">Bo&apos;lim / Bosqich</th>
                <th className="p-3">Partiya</th>
                <th className="p-3">Qo&apos;lidagi Qty / Vazn</th>
                <th className="p-3">Holati</th>
              </tr>
            </thead>
            <tbody>
              {wipTasks.map((w, i) => (
                <tr key={i} className="border-b">
                  <td className="p-3 font-bold text-blue-700">{w.assigned_worker || "-"}</td>
                  <td className="p-3 font-semibold">
                    {w.department} — {w.stage_name}
                  </td>
                  <td className="p-3 font-bold">{w.batch_no}</td>
                  <td className="p-3 font-bold text-emerald-700">
                    {w.available_qty} dona ({w.input_weight} gr)
                  </td>
                  <td className="p-3">
                    <span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full text-xs font-bold">
                      WORKING ({w.queue_status})
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
