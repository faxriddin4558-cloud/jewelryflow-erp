"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);

  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [productDetails, setProductDetails] = useState("");
  const [advancePayment, setAdvancePayment] = useState<number | "">("");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState("Kutilmoqda");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const supabase = createSupabaseBrowserClient();

  const fetchOrders = async () => {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setOrders(data);
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("orders").insert([
      { 
        client_name: clientName, 
        phone: phone, 
        product_details: productDetails,
        advance_payment: Number(advancePayment || 0),
        deadline: deadline,
        status: status
      }
    ]);

    if (!error) {
      setMessage("✅ Buyurtma muvaffaqiyatli qabul qilindi!");
      fetchOrders();
      setClientName(""); setPhone(""); setProductDetails(""); setAdvancePayment(""); setDeadline("");
    } else {
      setMessage("Xato: " + error.message);
    }
    setLoading(false);
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Mijozlar va Buyurtmalar</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Yangi buyurtma qabul qilish */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit col-span-1">
          <h2 className="text-xl font-semibold mb-6 border-b pb-4">Yangi buyurtma (Zakaz)</h2>
          
          {message && <div className={`mb-5 p-4 rounded-md font-medium ${message.includes("Xato") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>{message}</div>}
          
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Mijozning ismi</label>
              <input type="text" required value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Masalan: Sardor aka" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Telefon raqami</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Buyurtma tafsilotlari</label>
              <textarea required value={productDetails} onChange={(e) => setProductDetails(e.target.value)} placeholder="Masalan: 585 proba, 15gr, Bismark zanjir" rows={3} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Avans (so'm)</label>
                <input type="number" required value={advancePayment} onChange={(e) => setAdvancePayment(Number(e.target.value))} placeholder="500000" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Topshirish sanasi</label>
                <input type="date" required value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
            
            <button type="submit" disabled={loading} className="w-full mt-4 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700">
              {loading ? "Saqlanmoqda..." : "Buyurtmani qabul qilish"}
            </button>
          </form>
        </div>

        {/* Buyurtmalar ro'yxati */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 col-span-2">
          <h2 className="text-xl font-semibold mb-6 border-b pb-4">Faol buyurtmalar ro'yxati</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Mijoz</th>
                  <th className="px-4 py-3">Ma'lumot</th>
                  <th className="px-4 py-3">Avans</th>
                  <th className="px-4 py-3">Muddat</th>
                  <th className="px-4 py-3">Holati</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((item, idx) => (
                  <tr key={idx} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-gray-900">{item.client_name}</div>
                      <div className="text-xs text-blue-600">{item.phone}</div>
                    </td>
                    <td className="px-4 py-3">{item.product_details}</td>
                    <td className="px-4 py-3 font-semibold text-green-600">{Number(item.advance_payment).toLocaleString()}</td>
                    <td className="px-4 py-3 font-medium text-red-500">{item.deadline}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        item.status === 'Kutilmoqda' ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'
                      }`}>
                        {item.status}
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