"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

const DEPARTMENTS = ["Quyish", "Zaklirovka", "Sanding / Polirovka", "Lazer", "Moyka / Tozalash", "Tosh qo'yish", "Gipslash", "QC / Sifat nazorati", "Ombor", "Boshqaruv"];
const ROLES = ["Operator", "Supervisor", "Zargar", "Quyuvchi", "Zaklirovkachi", "Lazer operatori", "QC", "Omborchi", "Manager", "Admin"];
const SALARY_TYPES = ["Gramm bo'yicha", "Dona bo'yicha", "Kunlik", "Oylik"];

export default function EmployeesPage() {
  const [tab, setTab] = useState<"team" | "supervisor">("team");
  const [employees, setEmployees] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

  // Yangi xodim qo'shish
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dept, setDept] = useState("Sanding / Polirovka");
  const [role, setRole] = useState("Zargar");
  const [salType, setSalType] = useState("Gramm bo'yicha");
  const [rate, setRate] = useState("15000");

  // Ish haqi va to'lov yozish
  const [selEmp, setSelEmp] = useState("");
  const [actType, setActType] = useState("ish_haqi");
  const [workGram, setWorkGram] = useState("");
  const [workQty, setWorkQty] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [supDept, setSupDept] = useState("Sanding / Polirovka");

  const loadData = async () => {
    const { data: eData } = await supabase.from("employees").select("*").order("created_at", { ascending: false });
    if (eData) {
      setEmployees(eData);
      if (!selEmp && eData.length > 0) setSelEmp(eData[0].id);
    }
    const { data: bData } = await supabase.from("batches").select("*");
    if (bData) setBatches(bData);
    const { data: lData } = await supabase.from("employee_logs").select("*").order("created_at", { ascending: false }).limit(15);
    if (lData) setLogs(lData);
  };

  useEffect(() => { loadData(); }, []);

  // Stavka bo'yicha avtomatik summa hisoblash
  const currentEmpObj = employees.find(e => String(e.id) === String(selEmp));
  const autoCalcAmount = (g: string, q: string) => {
    if (!currentEmpObj || !currentEmpObj.rate) return;
    if (currentEmpObj.salary_type === "Gramm bo'yicha" && g) {
      setAmount(String(parseFloat(g) * Number(currentEmpObj.rate)));
    } else if (currentEmpObj.salary_type === "Dona bo'yicha" && q) {
      setAmount(String(parseInt(q) * Number(currentEmpObj.rate)));
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return alert("Ismni kiriting!");
    const { error } = await supabase.from("employees").insert([
      { name, phone, position: role, role_type: role, department: dept, salary_type: salType, rate: parseFloat(rate) || 0, balance: 0, status: "Faol" }
    ]);
    if (error) alert("Xatolik: " + error.message);
    else { setName(""); setPhone(""); loadData(); }
  };

  const handleTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEmpObj || !amount) return alert("Xodim va summani kiriting!");
    const sum = parseFloat(amount) || 0;
    const curBal = Number(currentEmpObj.balance || 0);
    const newBal = actType === "ish_haqi" ? curBal + sum : curBal - sum;

    const { error } = await supabase.from("employees").update({ balance: newBal }).eq("id", currentEmpObj.id);
    if (!error) {
      await supabase.from("employee_logs").insert([{
        employee_name: currentEmpObj.name,
        action_type: actType,
        amount: sum,
        gram_done: parseFloat(workGram) || 0,
        qty_done: parseInt(workQty) || 0,
        note: note || (actType === "ish_haqi" ? "Bajarilgan ish uchun" : "To'lov berildi")
      }]);
      setAmount(""); setWorkGram(""); setWorkQty(""); setNote("");
      loadData();
    }
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Xodimlar, Ish haqi va Supervisor Paneli</h1>
          <p className="text-xs text-slate-500 mt-1">Bo'limlar, stavkalar (gramm/dona/oylik), ish haqi balansi va Supervisor nazorati</p>
        </div>
        <div className="flex gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button onClick={() => setTab("team")} className={`px-4 py-2 rounded-lg text-xs font-bold ${tab === "team" ? "bg-blue-600 text-white" : "text-slate-600"}`}>
            👥 Jamoa & Ish haqi ({employees.length})
          </button>
          <button onClick={() => setTab("supervisor")} className={`px-4 py-2 rounded-lg text-xs font-bold ${tab === "supervisor" ? "bg-blue-600 text-white" : "text-slate-600"}`}>
            🛡️ Supervisor Dashboard
          </button>
        </div>
      </div>

      {tab === "team" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            {/* ISH HAQI VA TO'LOV FORMASI */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-3.5">
              <h2 className="text-base font-bold text-slate-800 border-b pb-2">💰 Ish haqi hisoblash va To'lov</h2>
              <form onSubmit={handleTransaction} className="space-y-3 text-sm">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Xodimni tanlang</label>
                  <select value={selEmp} onChange={e => setSelEmp(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-semibold bg-white">
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} — {emp.department || emp.position} ({emp.salary_type || "Stavka"})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Amaliyot turi</label>
                  <select value={actType} onChange={e => setActType(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-semibold bg-white">
                    <option value="ish_haqi">➕ Ish haqi yozish (Balans oshadi)</option>
                    <option value="tolov">➖ Pul berish / Avans (Balans kamayadi)</option>
                  </select>
                </div>
                {actType === "ish_haqi" && (
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-500">Ishlangan (gr)</label>
                      <input type="number" step="0.01" value={workGram} onChange={e => { setWorkGram(e.target.value); autoCalcAmount(e.target.value, workQty); }} placeholder="0.0" className="w-full border rounded-lg p-1.5 mt-0.5 bg-white" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-500">Ishlangan (dona)</label>
                      <input type="number" value={workQty} onChange={e => { setWorkQty(e.target.value); autoCalcAmount(workGram, e.target.value); }} placeholder="0" className="w-full border rounded-lg p-1.5 mt-0.5 bg-white" />
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-slate-600">Summa (so'm)</label>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Masalan: 500000" className="w-full border rounded-xl p-2.5 mt-1 font-bold text-slate-900" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Izoh (Partiya / ish turi)</label>
                  <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Masalan: B-0010 partiya polirovkasi" className="w-full border rounded-xl p-2.5 mt-1" />
                </div>
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow">Amaliyotni bajarish</button>
              </form>
            </div>

            {/* YANGI XODIM QO'SHISH */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-3">
              <h2 className="text-base font-bold text-slate-800 border-b pb-2">➕ Yangi xodim va Rol qo'shish</h2>
              <form onSubmit={handleAddEmployee} className="space-y-3 text-sm">
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ism familiyasi" className="w-full border rounded-xl p-2.5" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+998 90..." className="w-full border rounded-xl p-2" />
                  <select value={dept} onChange={e => setDept(e.target.value)} className="w-full border rounded-xl p-2 bg-white">
                    {DEPARTMENTS.map((d, i) => <option key={i} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={role} onChange={e => setRole(e.target.value)} className="w-full border rounded-xl p-2 bg-white">
                    {ROLES.map((r, i) => <option key={i} value={r}>{r}</option>)}
                  </select>
                  <select value={salType} onChange={e => setSalType(e.target.value)} className="w-full border rounded-xl p-2 bg-white">
                    {SALARY_TYPES.map((s, i) => <option key={i} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Stavka (1 gr / 1 dona / kunlik narxi so'mda)</label>
                  <input type="number" value={rate} onChange={e => setRate(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-semibold" />
                </div>
                <button type="submit" className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-2.5 rounded-xl">Xodimni qo'shish</button>
              </form>
            </div>
          </div>

          {/* O'NG TOMON: XODIMLAR JADVALI VA TARIX */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="text-base font-bold text-slate-800 mb-4">Jamoa, Bo'limlar va Joriy Balans (Qarzlarimiz)</h2>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                    <th className="p-3">Ismi / Tel</th>
                    <th className="p-3">Bo'lim & Rol</th>
                    <th className="p-3">Ish haqi turi / Stavka</th>
                    <th className="p-3 text-right">Joriy Balansi</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, i) => (
                    <tr key={i} className="border-b hover:bg-slate-50">
                      <td className="p-3">
                        <b className="text-slate-900">{emp.name}</b>
                        <div className="text-xs text-slate-400">{emp.phone}</div>
                      </td>
                      <td className="p-3">
                        <span className="font-semibold text-slate-700">{emp.department || "Ishlab chiqarish"}</span>
                        <div className="text-xs text-blue-600 font-medium">{emp.role_type || emp.position || "Zargar"}</div>
                      </td>
                      <td className="p-3 text-xs">
                        <span className="bg-slate-100 px-2 py-1 rounded font-semibold">{emp.salary_type || "Gramm bo'yicha"}</span>
                        {emp.rate > 0 && <div className="text-slate-500 mt-1">Stavka: {Number(emp.rate).toLocaleString()} so'm</div>}
                      </td>
                      <td className="p-3 text-right font-extrabold text-emerald-600 text-base">
                        {Number(emp.balance || 0).toLocaleString()} so'm
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <h3 className="text-sm font-bold text-slate-800 mb-3">Oxirgi hisoblangan ish haqi va to'lovlar tarixi</h3>
              <table className="w-full text-left text-xs">
                <thead><tr className="bg-slate-50 text-slate-500 border-b"><th className="p-2">Sana</th><th className="p-2">Xodim</th><th className="p-2">Turi</th><th className="p-2 text-right">Summa</th><th className="p-2">Izoh</th></tr></thead>
                <tbody>
                  {logs.map((l, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2 text-slate-400">{new Date(l.created_at).toLocaleDateString("uz-UZ")}</td>
                      <td className="p-2 font-bold">{l.employee_name}</td>
                      <td className="p-2"><span className={`px-2 py-0.5 rounded font-bold ${l.action_type === "ish_haqi" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{l.action_type === "ish_haqi" ? "+ Ish haqi" : "- To'lov"}</span></td>
                      <td className="p-2 text-right font-bold">{Number(l.amount).toLocaleString()} so'm</td>
                      <td className="p-2 text-slate-600">{l.note} {l.gram_done > 0 ? `(${l.gram_done}g)` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* SUPERVISOR DASHBOARD (PRD 24-band) */
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5">
          <div className="flex flex-wrap justify-between items-center gap-4 border-b pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">🛡️ Bo'lim Supervisori Boshqaruv Paneli</h2>
              <p className="text-xs text-slate-500">Ishchilar telefon ishlatmasdan, barcha jarayonni Supervisor shu yerdan nazorat qiladi</p>
            </div>
            <select value={supDept} onChange={e => setSupDept(e.target.value)} className="border-2 border-blue-500 rounded-xl p-2.5 font-bold text-sm bg-blue-50 text-blue-900">
              {DEPARTMENTS.map((d, i) => <option key={i} value={d}>{d} bo'limi</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-50 p-4 rounded-xl border">
              <span className="text-xs text-slate-500">Bo'limdagi xodimlar</span>
              <div className="text-2xl font-black text-slate-900 mt-1">{employees.filter(e => (e.department || "").includes(supDept.split(" ")[0])).length} nafar</div>
            </div>
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
              <span className="text-xs text-blue-700">Ishlanayotgan partiyalar</span>
              <div className="text-2xl font-black text-blue-900 mt-1">{batches.filter(b => b.status !== "Tugatildi").length} ta</div>
            </div>
            <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200">
              <span className="text-xs text-emerald-700">Tugatilgan partiyalar</span>
              <div className="text-2xl font-black text-emerald-900 mt-1">{batches.filter(b => b.status === "Tugatildi").length} ta</div>
            </div>
            <div className="bg-amber-50 p-4 rounded-xl border border-amber-200">
              <span className="text-xs text-amber-700">Jami xodimlar balansi</span>
              <div className="text-xl font-black text-amber-900 mt-1">{employees.reduce((s, e) => s + Number(e.balance || 0), 0).toLocaleString()} so'm</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}