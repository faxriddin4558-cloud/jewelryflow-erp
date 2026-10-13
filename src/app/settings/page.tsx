"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase,
  RBAC,
  GOLD_PRECISION_POLICY,
  logErpAudit,
  type EmployeeRow,
  type MachineRow,
  type ProductionStageRow,
} from "@/lib/erp-engine";

export default function SettingsPage() {
  const [tab, setTab] = useState<"system" | "employees" | "machines" | "stages">("system");
  const [currentUser, setCurrentUser] = useState(() => RBAC.getCurrentUser());
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [stages, setStages] = useState<ProductionStageRow[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // New employee form state (Admin / Director only)
  const [empName, setEmpName] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empDept, setEmpDept] = useState("Quyish");
  const [empRole, setEmpRole] = useState("Worker");
  const [empSalaryType, setEmpSalaryType] = useState("Grammabay");
  const [empRate, setEmpRate] = useState("15000");

  // New machine form state
  const [macName, setMacName] = useState("");
  const [macDept, setMacDept] = useState("Quyish");
  const [macCap, setMacCap] = useState("300");
  const [macStatus, setMacStatus] = useState("ACTIVE");

  const load = useCallback(async () => {
    setCurrentUser(RBAC.getCurrentUser());
    const [eRes, mRes, sRes] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: false }),
      supabase.from("machines").select("*").order("name"),
      supabase.from("production_stages").select("*").order("stage_order"),
    ]);
    if (eRes.data) setEmployees(eRes.data as EmployeeRow[]);
    if (mRes.data) setMachines(mRes.data as MachineRow[]);
    if (sRes.data) setStages(sRes.data as ProductionStageRow[]);
  }, []);

  useEffect(() => {
    setCurrentUser(RBAC.getCurrentUser());
    const unsubscribe = RBAC.subscribe((updatedUser) => {
      setCurrentUser(updatedUser);
    });
    void load();
    return () => {
      unsubscribe();
    };
  }, [load]);

  const isDirector = currentUser.role === "Director" || currentUser.role === "admin";
  const canManageFactory = isDirector || currentUser.role === "Production Manager";

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!isDirector) {
      alert("Ruxsat yo'q! Faqat Director yangi xodim va rolni ro'yxatdan o'tkaza oladi.");
      return;
    }
    const cleanName = empName.trim();
    const rateNum = Math.max(0, parseFloat(empRate) || 0);
    if (!cleanName) {
      alert("Xodim F.I.Sh. ni kiriting!");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const normalizedRole =
        empRole === "Director"
          ? "admin"
          : empRole === "Production Manager"
            ? "production_manager"
            : empRole === "Supervisor"
              ? "quality_control"
              : empRole === "Warehouse"
                ? "inventory_manager"
                : empRole === "Accountant"
                  ? "sales"
                  : "department_operator";
      const empCode = `EMP-${Date.now().toString().slice(-6)}`;

      const { data: created, error } = await supabase
        .from("employees")
        .insert([
          {
            employee_code: empCode,
            name: cleanName,
            full_name: cleanName,
            email: empEmail.trim().toLowerCase() || null,
            department: empDept,
            role: normalizedRole,
            role_type: empRole,
            position: empRole,
            salary_type: empSalaryType,
            rate: rateNum,
            balance: 0,
            status: "active",
            employment_status: "active",
            is_active: true,
          },
        ])
        .select()
        .single();

      if (error) {
        alert(`Xodimni saqlashda xatolik: ${error.message}`);
        return;
      }

      await logErpAudit({
        table: "employees",
        recordId: String((created as EmployeeRow)?.id ?? cleanName),
        action: "CREATE_EMPLOYEE",
        newData: created as Record<string, unknown>,
      });
      setEmpName("");
      setEmpEmail("");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleAddMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!canManageFactory) {
      alert("Ruxsat yo'q! Faqat Director yoki Production Manager uskuna qo'sha oladi.");
      return;
    }
    const cleanMac = macName.trim();
    const capNum = Math.max(1, parseInt(macCap, 10) || 100);
    if (!cleanMac) {
      alert("Uskuna nomini kiriting!");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const { data: created, error } = await supabase
        .from("machines")
        .insert([
          {
            name: cleanMac,
            department: macDept,
            daily_capacity: capNum,
            status: macStatus,
          },
        ])
        .select()
        .single();

      if (error) {
        alert(`Uskunani saqlashda xatolik: ${error.message}`);
        return;
      }

      await logErpAudit({
        table: "machines",
        recordId: cleanMac,
        action: "CREATE_MACHINE",
        newData: created as Record<string, unknown>,
      });
      setMacName("");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            ⚙️ Tizim Sozlamalari, Rollar, Uskunalar va 25-Bosqich Konfiguratsiyasi
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Oltin aniqlik siyosati (Precision Policy), xodimlar ruxsatlari (RBAC), zavod uskunalari va ishlab chiqarish bosqichlari
          </p>
        </div>
        <div className="flex gap-1.5 bg-slate-100 p-1.5 rounded-xl border">
          <button
            onClick={() => setTab("system")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "system" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            🛡️ Tizim &amp; RBAC
          </button>
          <button
            onClick={() => setTab("employees")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "employees" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            👥 Xodimlar ({employees.length})
          </button>
          <button
            onClick={() => setTab("machines")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "machines" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            🔬 Uskunalar ({machines.length})
          </button>
          <button
            onClick={() => setTab("stages")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "stages" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            🏭 25 Bosqich ({stages.length})
          </button>
        </div>
      </div>

      {tab === "system" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border space-y-3 text-sm">
            <h2 className="font-bold text-base border-b pb-2">
              🔐 Joriy Sessiya va Ruxsatlar (Supabase Auth + Server RLS)
            </h2>
            <div className="flex justify-between py-1 border-b">
              <span className="text-slate-500">Foydalanuvchi:</span>
              <b>{currentUser.name}</b>
            </div>
            <div className="flex justify-between py-1 border-b">
              <span className="text-slate-500">Email:</span>
              <b>{currentUser.email || "-"}</b>
            </div>
            <div className="flex justify-between py-1 border-b">
              <span className="text-slate-500">Tasdiqlangan Rol:</span>
              <span className="bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full text-xs font-bold">
                {currentUser.role}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b">
              <span className="text-slate-500">Bo&apos;lim:</span>
              <b>{currentUser.department}</b>
            </div>
            <div className="pt-2 space-y-1.5 text-xs">
              <div className="font-bold text-slate-600">Faol huquqlar:</div>
              {[
                ["edit_inventory", "Ombor va Qotishma/Affinaj (edit_inventory)"],
                ["create_batch", "Partiya ochish (create_batch)"],
                ["move_batch", "WIP bosqich ko'chirish (move_batch)"],
                ["split_batch", "Partiya bo'lish (split_batch)"],
                ["record_consumption", "Sarfiyat va Pateriya yozish (record_consumption)"],
                ["manage_products", "Mahsulot va BOM yaratish (manage_products)"],
                ["edit_sales", "Sotuv, Kassa va Qarz to'lovi (edit_sales)"],
                ["edit_salary_rate", "Ish haqi va Stavka boshqaruvi (edit_salary_rate)"],
              ].map(([perm, label]) => {
                const allowed = RBAC.hasPermission(currentUser.role, perm ?? "");
                return (
                  <div key={perm} className="flex justify-between bg-slate-50 p-2 rounded border">
                    <span>{label}</span>
                    <b className={allowed ? "text-emerald-600" : "text-red-500"}>
                      {allowed ? "✓ RUXSAT BOR" : "✕ TAQIQLANGAN"}
                    </b>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border space-y-3 text-sm h-fit">
            <h2 className="font-bold text-base border-b pb-2">
              ⚖️ Oltin va Moliya Aniqlik Siyosati (Precision Policy)
            </h2>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-slate-500">Oltin vazn aniqligi (Gross / WIP / Loss):</span>
              <b>NUMERIC(14, {GOLD_PRECISION_POLICY.WEIGHT_DECIMALS}) (0.0001 gr)</b>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-slate-500">Sof oltin (999.9) yig&apos;indi aniqligi:</span>
              <b>NUMERIC(18, {GOLD_PRECISION_POLICY.EXACT_FINE_GOLD_DECIMALS}) (0.000001 gr)</b>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-slate-500">100+ ketma-ket tranzaksiya og&apos;ish chegarasi:</span>
              <b className="text-emerald-700">
                &le; {GOLD_PRECISION_POLICY.SEQUENTIAL_DRIFT_TOLERANCE_GRAM} gr
              </b>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-slate-500">Partiya Mass-Balance ruxsat etilgan farq:</span>
              <b>&plusmn;{GOLD_PRECISION_POLICY.MASS_BALANCE_TOLERANCE_GRAM} gr</b>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-slate-500">Valyuta va Kassa aniqligi:</span>
              <b>NUMERIC(18, {GOLD_PRECISION_POLICY.CURRENCY_DECIMALS})</b>
            </div>
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs text-amber-900">
              <b>O&apos;zgarmas Ledger Qoidasi:</b> <code>gold_transactions</code>,{" "}
              <code>salary_ledger</code>, <code>debt_repayments</code>,{" "}
              <code>affinaj_records</code> va <code>audit_logs</code> jadvallari append-only
              hisoblanadi va ulardagi yozuvlarni o&apos;chirish database triggerlari orqali
              bloklangan.
            </div>
          </div>
        </div>
      )}

      {tab === "employees" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={(e) => void handleAddEmployee(e)}
            className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit"
          >
            <h2 className="font-bold border-b pb-2">➕ Yangi Xodim Ro&apos;yxatdan O&apos;tkazish</h2>
            <input
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              placeholder="F.I.Sh. (Usta Sardor)"
              className="w-full border rounded-xl p-2 font-bold"
            />
            <input
              type="email"
              value={empEmail}
              onChange={(e) => setEmpEmail(e.target.value)}
              placeholder="Email (Supabase Auth bog'lash uchun)"
              className="w-full border rounded-xl p-2"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={empDept}
                onChange={(e) => setEmpDept(e.target.value)}
                className="border rounded-xl p-2 bg-white font-semibold"
              >
                <option>Boshqaruv</option>
                <option>Quyish</option>
                <option>Zaklirovka</option>
                <option>Sanding</option>
                <option>Polirovka</option>
                <option>Tosh qo&apos;yish</option>
                <option>Lazer</option>
                <option>QC</option>
                <option>Ombor</option>
                <option>Buxgalteriya</option>
              </select>
              <select
                value={empRole}
                onChange={(e) => setEmpRole(e.target.value)}
                className="border rounded-xl p-2 bg-white font-bold"
              >
                <option value="Worker">Worker</option>
                <option value="Supervisor">Supervisor (Bosh usta)</option>
                <option value="Production Manager">Production Manager</option>
                <option value="Warehouse">Warehouse (Omborchi)</option>
                <option value="Accountant">Accountant (Buxgalter)</option>
                <option value="Director">Director</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={empSalaryType}
                onChange={(e) => setEmpSalaryType(e.target.value)}
                className="border rounded-xl p-2 bg-white"
              >
                <option>Grammabay</option>
                <option>Donabay</option>
                <option>Oylik (Fixed)</option>
              </select>
              <input
                type="number"
                value={empRate}
                onChange={(e) => setEmpRate(e.target.value)}
                placeholder="Stavka (so'm)"
                className="border rounded-xl p-2 font-bold"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl"
            >
              Xodimni saqlash
            </button>
          </form>

          <div className="lg:col-span-2 bg-white p-5 rounded-2xl border">
            <h2 className="font-bold mb-3">Ro&apos;yxatdagi Xodimlar va Rollar</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b">
                  <th className="p-2.5">F.I.Sh. / Email</th>
                  <th className="p-2.5">Bo&apos;lim</th>
                  <th className="p-2.5">Rol</th>
                  <th className="p-2.5 text-right">Stavka</th>
                  <th className="p-2.5 text-right">Balans</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((em, idx) => (
                  <tr key={em.id || idx} className="border-b">
                    <td className="p-2.5">
                      <b>{em.name || em.full_name}</b>
                      {em.email && <div className="text-[11px] text-slate-400">{em.email}</div>}
                    </td>
                    <td className="p-2.5">{em.department || "Sex"}</td>
                    <td className="p-2.5 font-bold text-blue-700">
                      {em.role_type || em.position || em.role || "Worker"}
                    </td>
                    <td className="p-2.5 text-right">
                      {Number(em.rate ?? 0).toLocaleString()} so&apos;m
                    </td>
                    <td className="p-2.5 text-right font-bold text-emerald-700">
                      {Number(em.balance ?? 0).toLocaleString()} so&apos;m
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "machines" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={(e) => void handleAddMachine(e)}
            className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit"
          >
            <h2 className="font-bold border-b pb-2">➕ Yangi Zavod Uskunasi Qo&apos;shish</h2>
            <input
              value={macName}
              onChange={(e) => setMacName(e.target.value)}
              placeholder="Uskuna nomi (Vakuum Quyish Pechi #2)"
              className="w-full border rounded-xl p-2 font-bold"
            />
            <select
              value={macDept}
              onChange={(e) => setMacDept(e.target.value)}
              className="w-full border rounded-xl p-2 bg-white font-semibold"
            >
              <option>Quyish</option>
              <option>Zaklirovka</option>
              <option>Sanding</option>
              <option>Ponza</option>
              <option>Polirovka</option>
              <option>Tosh qo&apos;yish</option>
              <option>Lazer</option>
              <option>Moyka</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={macCap}
                onChange={(e) => setMacCap(e.target.value)}
                placeholder="Kunlik quvvat (pcs/day)"
                className="border rounded-xl p-2 font-bold"
              />
              <select
                value={macStatus}
                onChange={(e) => setMacStatus(e.target.value)}
                className="border rounded-xl p-2 bg-white font-bold"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="MAINTENANCE">MAINTENANCE</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 rounded-xl"
            >
              Uskunani saqlash
            </button>
          </form>

          <div className="lg:col-span-2 bg-white p-5 rounded-2xl border">
            <h2 className="font-bold mb-3">Zavod Uskunalari va Kunlik Quvvat</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b">
                  <th className="p-2.5">Uskuna</th>
                  <th className="p-2.5">Bo&apos;lim</th>
                  <th className="p-2.5 text-right">Quvvat (pcs/day)</th>
                  <th className="p-2.5 text-center">Holat</th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m, i) => (
                  <tr key={m.id || i} className="border-b">
                    <td className="p-2.5 font-bold">{m.name}</td>
                    <td className="p-2.5">{m.department}</td>
                    <td className="p-2.5 text-right font-semibold">{m.daily_capacity ?? 0}</td>
                    <td className="p-2.5 text-center">
                      <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold">
                        {m.status || "ACTIVE"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "stages" && (
        <div className="bg-white p-5 rounded-2xl border">
          <h2 className="font-bold mb-3">
            🏭 25 Bosqichli Zargarlik Ishlab Chiqarish Zanjiri (production_stages)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs">
            {stages.map((st) => (
              <div key={st.stage_order} className="p-3 rounded-xl border bg-slate-50 space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-purple-700">
                  <span>Bosqich #{st.stage_order}</span>
                  <span>{st.department || "Sex"}</span>
                </div>
                <div className="font-bold text-slate-900">{st.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
