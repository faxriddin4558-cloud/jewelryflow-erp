"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function BatchesPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);

  const [batchNumber, setBatchNumber] = useState("");
  const [productType, setProductType] = useState("");
  const [workerName, setWorkerName] = useState("");
  
  // Boshlang'ich holatni inglizcha "pending" qilib belgilaymiz
  const [status, setStatus] = useState("pending");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const supabase = createSupabaseBrowserClient();

  const fetchData = async () => {
    const [bRes, eRes] = await Promise.all([
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("employees").select("full_name").order("full_name", { ascending: true })
    ]);
    
    if (bRes.data) setBatches(bRes.data);
    if (eRes.data) setEmployees(eRes.data);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("batches").insert([
      { 
        batch_number: batchNumber, 
        product_type: productType, 
        worker_name: workerName,
        status: status // Bazaga "pending" yoki "completed" ketadi
      }
    ]);

    if (!error) {
      setMessage("✅ Partiya muvaffaqiyatli yaratildi va ustaga biriktirildi!");
      fetchData();
      setBatchNumber(""); setProductType(""); setWorkerName("");
    } else {
      setMessage("Xato: " + error.message);
    }
    setLoading(false);
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Ishlab chiqarish (Partiyalar)</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit col-span-1">
          <h2 className="text-xl font-semibold mb-6 border-b pb-4">Yangi partiya ochish</h2>
          
          {message && <div className={`mb-5 p-4 rounded-md font-medium ${message.includes("Xato") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>{message}</div>}
          
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Partiya raqami</label>
              <input type="text" required value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="Masalan: B-0010" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none uppercase" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Nima yasaladi?</label>
              <input type="text" required value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="Masalan: Komplekt" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Mas'ul usta (Zargar)</label>
              <select required value={workerName} onChange={(e) => setWorkerName(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none">
                <option value="">-- Ustani tanlang --</option>
                {employees.map((emp, idx) => (
                  <option key={idx} value={emp.full_name}>{emp.full_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Holati</label>
              {/* Ekranda o'zbekcha, orqada inglizcha qiymat */}
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none">
                <option value="pending">Jarayonda</option>
                <option value="completed">Tugatildi</option>
              </select>
            </div>
            
            <button type="submit" disabled={loading} className="w-full mt-4 rounded-md bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700">
              {loading ? "Ochilmoqda..." : "Partiyani boshlash"}
            </button>
          </form>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 col-span-2">
          <h2 className="text-xl font-semibold mb-6 border-b pb-4">Jarayondagi va Tugatilgan partiyalar</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Partiya No</th>
                  <th className="px-4 py-3">Mahsulot</th>
                  <th className="px-4 py-3">Usta (Zargar)</th>
                  <th className="px-4 py-3">Holati</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((item, idx) => (
                  <tr key={idx} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-bold text-gray-900">{item.batch_number}</td>
                    <td className="px-4 py-3 font-medium">{item.product_type}</td>
                    <td className="px-4 py-3 text-blue-600 font-semibold">{item.worker_name || "Biriktirilmagan"}</td>
                    <td className="px-4 py-3">
                      {/* Holatni yana o'zbekchaga o'girib chiqaramiz */}
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        item.status === 'pending' ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'
                      }`}>
                        {item.status === 'pending' ? 'Jarayonda' : 'Tugatildi'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}