"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<any[]>([]);
  
  // Xodim qo'shish formasi state'lari
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Zargar");

  // Ish haqi (Tranzaksiya) formasi state'lari
  const [selectedEmp, setSelectedEmp] = useState("");
  const [operationType, setOperationType] = useState("Ish haqi yozildi");
  const [amount, setAmount] = useState<number | "">("");
  const [description, setDescription] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const supabase = createSupabaseBrowserClient();

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from("employees")
      .select("*")
      .order("full_name", { ascending: true });
    if (data) setEmployees(data);
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  // Yangi xodim qo'shish funksiyasi
  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.from("employees").insert([
      { full_name: fullName, phone: phone, role: role, balance: 0 }
    ]);
    if (!error) {
      setMessage("✅ Yangi xodim qo'shildi!");
      fetchEmployees();
      setFullName(""); setPhone(""); setRole("Zargar");
    }
    setLoading(false);
  };

  // Balansga pul qo'shish yoki ayirish funksiyasi
  const handleTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const emp = employees.find(e => e.full_name === selectedEmp);
    if (!emp) return setLoading(false);

    // Agar ish haqi yozilsa balans oshadi (qarzimiz ko'payadi), pul bersak balans kamayadi
    const currentBalance = Number(emp.balance || 0);
    const numAmount = Number(amount || 0);
    const newBalance = operationType === "Ish haqi yozildi" 
      ? currentBalance + numAmount 
      : currentBalance - numAmount;

    // 1. Tranzaksiyani tarixga yozamiz
    const { error: payrollError } = await supabase.from("payroll").insert([
      { employee_name: selectedEmp, amount: numAmount, operation_type: operationType, description: description }
    ]);

    // 2. Xodimning balansini yangilaymiz
    if (!payrollError) {
      await supabase.from("employees").update({ balance: newBalance }).eq("id", emp.id);
      setMessage(`✅ ${selectedEmp}ning balansi yangilandi!`);
      fetchEmployees();
      setSelectedEmp(""); setAmount(""); setDescription("");
    } else {
      setMessage("Xato: " + payrollError.message);
    }
    setLoading(false);
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Xodimlar va Ish haqi balansi</h1>
      
      {message && <div className="mb-6 p-4 rounded-md font-medium bg-green-50 text-green-700 border border-green-200">{message}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Chap panel: Qo'shish va To'lov formasi */}
        <div className="col-span-1 space-y-8">
          
          {/* Oylik va Tranzaksiya */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold mb-6 border-b pb-4 text-blue-800">💰 Ish haqi va To'lovlar</h2>
            <form onSubmit={handleTransaction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Xodimni tanlang</label>
                <select required value={selectedEmp} onChange={(e) => setSelectedEmp(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none">
                  <option value="">-- Tanlang --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.full_name}>{emp.full_name} (Balans: {Number(emp.balance).toLocaleString()})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Amaliyot turi</label>
                <select value={operationType} onChange={(e) => setOperationType(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none font-medium">
                  <option value="Ish haqi yozildi">➕ Ish haqi yozish (Balans oshadi)</option>
                  <option value="Pul berildi (Avans/Oylik)">➖ Pul berish (Balans kamayadi)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Summa (so'm)</label>
                <input type="number" required value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" placeholder="Masalan: 500000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Izoh (ixtiyoriy)</label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" placeholder="Masalan: 10 gr bismark uchun" />
              </div>
              <button type="submit" disabled={loading} className="w-full mt-4 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700">
                Amaliyotni bajarish
              </button>
            </form>
          </div>

          {/* Yangi xodim qo'shish */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold mb-6 border-b pb-4">Yangi xodim qo'shish</h2>
            <form onSubmit={handleAddEmployee} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Ism familiya</label>
                <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Telefon</label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Lavozim</label>
                  <input type="text" value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full mt-4 rounded-md bg-gray-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-900">
                Xodimni qo'shish
              </button>
            </form>
          </div>

        </div>

        {/* O'ng panel: Xodimlar ro'yxati va Balanslari */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 col-span-2">
          <h2 className="text-xl font-semibold mb-6 border-b pb-4">Jamoa va Joriy Balans (Qarzlarimiz)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Ismi</th>
                  <th className="px-4 py-3">Lavozimi / Tel</th>
                  <th className="px-4 py-3 text-right">Joriy Balansi (so'm)</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-bold text-gray-900">{emp.full_name}</td>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-gray-700">{emp.role}</span>
                      <span className="block text-xs text-gray-400">{emp.phone || '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* Agar balans minusga kirsa (biz haqdor bo'lsak) qizil, plusda bo'lsa yashil */}
                      <span className={`text-lg font-bold ${Number(emp.balance) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {Number(emp.balance).toLocaleString()} 
                      </span>
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500">Hozircha xodimlar kiritilmagan</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}