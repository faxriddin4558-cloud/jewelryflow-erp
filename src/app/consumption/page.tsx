"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ConsumptionPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [consumptions, setConsumptions] = useState<any[]>([]);

  const [selectedBatch, setSelectedBatch] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [givenWeight, setGivenWeight] = useState<number | "">("");
  const [returnedWeight, setReturnedWeight] = useState<number | "">("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const supabase = createSupabaseBrowserClient();

  const fetchData = async () => {
    // Endi qanaqa holatda bo'lishidan qat'iy nazar HAMMA partiyalarni tortib kelamiz
    const [bRes, cRes] = await Promise.all([
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("consumption").select("*").order("created_at", { ascending: false })
    ]);
    if (bRes.data) setBatches(bRes.data);
    if (cRes.data) setConsumptions(cRes.data);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleBatchChange = (bNum: string) => {
    setSelectedBatch(bNum);
    const batch = batches.find(b => b.batch_number === bNum);
    // Partiya tanlansa, usta avtomat yoziladi. Lekin xohlasangiz uni o'chirib o'zingiz ham yozishingiz mumkin bo'ladi
    if (batch && batch.worker_name) {
      setWorkerName(batch.worker_name);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const loss = Number(givenWeight) - Number(returnedWeight);

    const { error } = await supabase.from("consumption").insert([
      { 
        batch_number: selectedBatch, 
        worker_name: workerName, 
        given_weight: Number(givenWeight),
        returned_weight: Number(returnedWeight),
        loss_weight: loss
      }
    ]);

    if (!error) {
      setMessage(`✅ Hisobot saqlandi! Pateriya: ${loss.toFixed(2)} gr`);
      fetchData();
      setSelectedBatch(""); setWorkerName(""); setGivenWeight(""); setReturnedWeight("");
    } else {
      setMessage("Xato: " + error.message);
    }
    setLoading(false);
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Sarfiyat va Pateriya Hisobi</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit col-span-1">
          <h2 className="text-xl font-semibold mb-6 border-b pb-4">Pateriyani hisoblash</h2>
          
          {message && <div className={`mb-5 p-4 rounded-md font-medium ${message.includes("Xato") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>{message}</div>}
          
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Qaysi partiya?</label>
              <select required value={selectedBatch} onChange={(e) => handleBatchChange(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none">
                <option value="">-- Partiyani tanlang --</option>
                {batches.map((b, i) => <option key={i} value={b.batch_number}>{b.batch_number}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Mas'ul usta</label>
              {/* Blokirovkani (readOnly) olib tashladik. Endi qo'lda ham yoza olasiz! */}
              <input type="text" required value={workerName} onChange={(e) => setWorkerName(e.target.value)} placeholder="Ustaning ismi..." className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Berilgan (gr)</label>
                <input type="number" step="0.01" required value={givenWeight} onChange={(e) => setGivenWeight(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Qaytdi (gr)</label>
                <input type="number" step="0.01" required value={returnedWeight} onChange={(e) => setReturnedWeight(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
              </div>
            </div>

            {(givenWeight && returnedWeight) ? (
              <div className="mt-4 p-3 bg-red-50 rounded-lg text-center border border-red-100">
                <span className="text-sm text-red-600 block">Kutilayotgan pateriya:</span>
                <span className="text-xl font-bold text-red-700">{(Number(givenWeight) - Number(returnedWeight)).toFixed(2)} gr</span>
              </div>
            ) : null}
            
            <button type="submit" disabled={loading || !selectedBatch} className="w-full mt-4 rounded-md bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600">
              {loading ? "Saqlanmoqda..." : "Hisobotni saqlash"}
            </button>
          </form>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 col-span-2">
          <h2 className="text-xl font-semibold mb-6 border-b pb-4">Pateriya va yo'qotishlar tarixi</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Partiya</th>
                  <th className="px-4 py-3">Usta</th>
                  <th className="px-4 py-3">Berildi</th>
                  <th className="px-4 py-3">Qaytdi</th>
                  <th className="px-4 py-3">Pateriya</th>
                </tr>
              </thead>
              <tbody>
                {consumptions.map((item, idx) => (
                  <tr key={idx} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.batch_number}</td>
                    <td className="px-4 py-3">{item.worker_name}</td>
                    <td className="px-4 py-3">{item.given_weight} gr</td>
                    <td className="px-4 py-3">{item.returned_weight} gr</td>
                    <td className="px-4 py-3 font-bold text-red-600">{item.loss_weight} gr</td>
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