"use client";
import { useState, useEffect } from "react";
import { supabase, RBAC, logErpAudit } from "@/lib/erp-engine";

export default function EmployeesPage() {
  const [tab, setTab] = useState<"salary" | "supervisor">("salary");
  const [employees, setEmployees] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [wipTasks, setWipTasks] = useState<any[]>([]);
  const [selEmp, setSelEmp] = useState("Valijon");
  const [batchNo, setBatchNo] = useState("B-0010");
  const [stageName, setStageName] = useState("8. Quyish (Casting)");
  const [txType, setTxType] = useState<"EARNED" | "PAID">("EARNED");
  const [gramDone, setGramDone] = useState("50");
  const [rate, setRate] = useState("15000");
  const [amount, setAmount] = useState("750000");

  const load = async () => {
    const [e, l, w] = await Promise.all([
      supabase.from("employees").select("*"),
      supabase.from("salary_ledger").select("*").order("created_at", { ascending: false }),
      supabase.from("batch_stage_wip").select("*").gt("available_qty", 0)
    ]);
    if (e.data) setEmployees(e.data);
    if (l.data) setLedger(l.data);
    if (w.data) setWipTasks(w.data);
  };
  useEffect(() => { load(); }, []);

  // 19-BAND: DUPLICATE SALARY GUARD
  const recordSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!RBAC.can("edit_salary_rate")) return alert("Ruxsat yo'q! Faqat Accountant yoki Director ish haqi yoza oladi.");
    const sum = parseFloat(amount) || 0;
    if (sum <= 0) return alert("Summa 0 dan katta bo'lishi shart!");

    if (txType === "EARNED") {
      const dup = ledger.find(x => x.worker_name === selEmp && x.batch_no === batchNo && x.stage_name === stageName && x.tx_type === "EARNED");
      if (dup) return alert(`XATO (Duplicate Salary Guard): ${selEmp} uchun ${batchNo} partiyaning "${stageName}" bosqichiga ish haqi allaqachon yozilgan!`);
    }

    await supabase.from("salary_ledger").insert([{
      worker_name: selEmp, batch_no: batchNo, stage_name: stageName, tx_type: txType,
      weight_done: parseFloat(gramDone) || 0, rate: parseFloat(rate) || 0, amount: sum,
      payment_status: txType === "PAID" ? "PAID" : "UNPAID", note: `${batchNo} - ${stageName}`
    }]);

    const empObj = employees.find(x => x.name === selEmp);
    if (empObj) {
      const curB = Number(empObj.balance || 0);
      await supabase.from("employees").update({ balance: txType === "EARNED" ? curB + sum : curB - sum }).eq("id", empObj.id);
    }
    await logErpAudit({ table: "salary_ledger", recordId: batchNo, action: `SALARY_${txType}`, newData: { selEmp, batchNo, stageName, sum } });
    alert("Ish haqi amaliyoti audit jurnaliga yozildi!");
    load();
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Xodimlar, Ish Haqi (Duplicate Guard) & Supervisor Sex Paneli</h1>
        <div className="flex gap-2 bg-slate-100 p-1.5 rounded-xl border">
          <button onClick={() => setTab("salary")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === "salary" ? "bg-blue-600 text-white" : ""}`}>💰 Ish haqi & Jamoa</button>
          <button onClick={() => setTab("supervisor")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === "supervisor" ? "bg-blue-600 text-white" : ""}`}>🛡️ Supervisor: WHO IS WORKING ON WHAT</button>
        </div>
      </div>

      {tab === "salary" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={recordSalary} className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit">
            <h2 className="font-bold border-b pb-2">Ish haqi yozish (Ikki marta yozishdan himoyalangan)</h2>
            <select value={selEmp} onChange={e => setSelEmp(e.target.value)} className="w-full border rounded-xl p-2 bg-white font-bold">
              <option value="Valijon">Valijon</option>
              {employees.map((em, i) => <option key={i} value={em.name}>{em.name}</option>)}
            </select>
            <select value={txType} onChange={e => setTxType(e.target.value as any)} className="w-full border rounded-xl p-2 bg-white font-bold">
              <option value="EARNED">➕ Ish haqi hisoblash (UNPAID)</option>
              <option value="PAID">➖ To'lov berish (PAID)</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input value={batchNo} onChange={e => setBatchNo(e.target.value)} placeholder="Batch (B-0010)" className="border rounded-xl p-2 font-bold" />
              <input value={stageName} onChange={e => setStageName(e.target.value)} placeholder="Bosqich" className="border rounded-xl p-2" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-slate-500">Ishlangan (gr)</label><input type="number" value={gramDone} onChange={e => { setGramDone(e.target.value); setAmount(String((parseFloat(e.target.value) || 0) * (parseFloat(rate) || 0))); }} className="w-full border rounded-xl p-2 font-bold" /></div>
              <div><label className="text-xs text-slate-500">Stavka (so'm)</label><input type="number" value={rate} onChange={e => { setRate(e.target.value); setAmount(String((parseFloat(gramDone) || 0) * (parseFloat(e.target.value) || 0))); }} className="w-full border rounded-xl p-2 font-bold" /></div>
            </div>
            <div><label className="text-xs text-slate-500">Jami Summa (so'm)</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border rounded-xl p-2 font-black text-emerald-700" /></div>
            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-xl">Tasdiqlash</button>
          </form>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-5 rounded-2xl border">
              <h3 className="font-bold mb-3">Xodimlar Balansi va Salary Ledger (PAID / UNPAID)</h3>
              <table className="w-full text-left text-xs">
                <thead><tr className="bg-slate-50 border-b"><th className="p-2">Sana</th><th className="p-2">Xodim</th><th className="p-2">Partiya / Bosqich</th><th className="p-2 text-right">Summa</th><th className="p-2 text-center">Status</th></tr></thead>
                <tbody>
                  {ledger.map((l, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2">{new Date(l.created_at).toLocaleDateString("uz-UZ")}</td>
                      <td className="p-2 font-bold">{l.worker_name}</td>
                      <td className="p-2">{l.batch_no} — {l.stage_name} ({l.weight_done}g)</td>
                      <td className="p-2 text-right font-bold">{Number(l.amount).toLocaleString()} so'm</td>
                      <td className="p-2 text-center"><span className={`px-2 py-0.5 rounded font-bold ${l.payment_status === "PAID" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{l.payment_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-6 rounded-2xl border space-y-4">
          <h2 className="text-lg font-bold">🛡️ Supervisor Paneli: WHO IS WORKING ON WHAT (Real-Time Sex Taqsimoti)</h2>
          <table className="w-full text-left text-sm">
            <thead><tr className="bg-slate-50 text-xs text-slate-500 border-b"><th className="p-3">Usta (Worker)</th><th className="p-3">Bo'lim / Bosqich</th><th className="p-3">Partiya</th><th className="p-3">Qo'lidagi Qty / Vazn</th><th className="p-3">Holati</th></tr></thead>
            <tbody>
              {wipTasks.map((w, i) => (
                <tr key={i} className="border-b">
                  <td className="p-3 font-bold text-blue-700">{w.assigned_worker || "Valijon"}</td>
                  <td className="p-3 font-semibold">{w.department} — {w.stage_name}</td>
                  <td className="p-3 font-bold">{w.batch_no}</td>
                  <td className="p-3 font-bold text-emerald-700">{w.available_qty} dona ({w.input_weight} gr)</td>
                  <td className="p-3"><span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full text-xs font-bold">WORKING ({w.queue_status})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
