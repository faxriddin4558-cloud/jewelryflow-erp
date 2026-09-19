"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SalesPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  
  const [clientName, setClientName] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [weight, setWeight] = useState<number | "">("");
  const [soldQty, setSoldQty] = useState<number | "">("");
  const [totalPrice, setTotalPrice] = useState<number | "">("");
  const [paymentType, setPaymentType] = useState("Naqd pul");
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // CHEK UCHUN STATE
  const [selectedReceipt, setSelectedReceipt] = useState<any>(null);

  const supabase = createSupabaseBrowserClient();

  const fetchData = async () => {
    const [pRes, sRes] = await Promise.all([
      supabase.from("products").select("*").gt("quantity", 0).order("created_at", { ascending: false }),
      supabase.from("sales").select("*").order("created_at", { ascending: false })
    ]);
    if (pRes.data) setProducts(pRes.data);
    if (sRes.data) setSales(sRes.data);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) {
      setMessage("Xato: Mahsulotni tanlang!"); return;
    }
    setLoading(true);

    const targetProduct = products.find(p => String(p.id) === String(selectedProductId));
    if (!targetProduct) {
      setMessage("Xato: Tanlangan mahsulot topilmadi!"); setLoading(false); return;
    }

    const { error: saleError } = await supabase.from("sales").insert([
      { 
        client_name: clientName, product_name: targetProduct.name, 
        weight: Number(weight), total_price: Number(totalPrice), payment_type: paymentType
      }
    ]);

    if (!saleError) {
      // Vitrinadan ayirish
      const newQty = Math.max(0, targetProduct.quantity - Number(soldQty || 1));
      const newWeight = Math.max(0, targetProduct.weight - Number(weight || 0));
      await supabase.from("products").update({ quantity: newQty, weight: newWeight }).eq("id", targetProduct.id);

      setMessage("✅ Sotuv amalga oshirildi!");
      fetchData();
      setClientName(""); setWeight(""); setSoldQty(""); setTotalPrice("");
    } else {
      setMessage("Xato: " + saleError.message);
    }
    setLoading(false);
  };

  return (
    <>
      {/* ASOSIY SAHIFA (Chek chop etilayotganda bu qism orqa fonda yashirinadi print:hidden) */}
      <div className={`p-8 bg-gray-50 min-h-screen ${selectedReceipt ? 'print:hidden' : ''}`}>
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Sotuv va Kassa</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit col-span-1">
            <h2 className="text-xl font-semibold mb-6 border-b pb-4">Mahsulot sotish</h2>
            {message && <div className={`mb-5 p-4 rounded-md font-medium ${message.includes("Xato") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>{message}</div>}
            
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Xaridor (Mijoz)</label>
                <input type="text" required value={clientName} onChange={(e) => setClientName(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Qaysi mahsulot?</label>
                <select required value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none">
                  <option value="">-- Mahsulotni tanlang --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.quantity} dona, {p.weight} gr)</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Soni (dona)</label>
                  <input type="number" required value={soldQty} onChange={(e) => setSoldQty(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Vazni (gr)</label>
                  <input type="number" step="0.01" required value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">To'lov</label>
                  <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none">
                    <option value="Naqd pul">Naqd pul</option>
                    <option value="Karta (Terminal)">Karta</option>
                    <option value="Pul o'tkazish">Pul o'tkazish</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Summa</label>
                  <input type="number" required value={totalPrice} onChange={(e) => setTotalPrice(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 font-bold text-green-600 focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              
              <button type="submit" disabled={loading} className="w-full mt-4 rounded-md bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700">
                {loading ? "Sotilmoqda..." : "Sotuvni tasdiqlash"}
              </button>
            </form>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 col-span-2">
            <h2 className="text-xl font-semibold mb-6 border-b pb-4">So'nggi sotuvlar tarixi</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-600">
                <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3">Xaridor</th>
                    <th className="px-4 py-3">Mahsulot / Vazn</th>
                    <th className="px-4 py-3">Summa</th>
                    <th className="px-4 py-3">Harakat</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((item, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{item.client_name}</td>
                      <td className="px-4 py-3">{item.product_name} <span className="text-gray-400">({item.weight}gr)</span></td>
                      <td className="px-4 py-3 font-bold text-green-600">{Number(item.total_price).toLocaleString()} so'm</td>
                      <td className="px-4 py-3">
                        <button 
                          onClick={() => setSelectedReceipt(item)}
                          className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-semibold text-xs border border-blue-200 transition-colors">
                          📄 Chek
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* CHEK OYNASI (MODAL) - Chop etishda faqat shu ko'rinadi */}
      {selectedReceipt && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-60 flex items-center justify-center z-50 print:bg-white print:opacity-100">
          <div className="bg-white p-8 rounded-xl w-96 max-w-full shadow-2xl print:shadow-none print:w-full print:p-0">
            
            <div className="text-center border-b-2 border-dashed border-gray-300 pb-4 mb-4">
              <div className="w-14 h-14 bg-blue-900 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-3 shadow-md print:shadow-none">J</div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">JewelryFlow</h2>
              <p className="text-gray-500 text-sm font-medium uppercase tracking-widest mt-1">Zargarlik do'koni</p>
            </div>
            
            <div className="space-y-3 text-sm text-gray-700 mb-6 font-medium">
              <div className="flex justify-between"><span>Sana:</span> <span>{new Date(selectedReceipt.created_at).toLocaleString('uz-UZ').slice(0, 17)}</span></div>
              <div className="flex justify-between"><span>Xaridor:</span> <span className="font-bold text-gray-900">{selectedReceipt.client_name}</span></div>
              <div className="flex justify-between"><span>Mahsulot:</span> <span>{selectedReceipt.product_name}</span></div>
              <div className="flex justify-between"><span>Vazni:</span> <span>{selectedReceipt.weight} gr</span></div>
              <div className="flex justify-between"><span>To'lov turi:</span> <span>{selectedReceipt.payment_type}</span></div>
            </div>
            
            <div className="border-t-2 border-dashed border-gray-300 pt-4 flex justify-between items-center mb-6">
              <span className="font-bold text-gray-700 uppercase tracking-wide text-xs">Jami to'lov:</span>
              <span className="text-xl font-black text-gray-900">{Number(selectedReceipt.total_price).toLocaleString()} <span className="text-sm font-medium">so'm</span></span>
            </div>
            
            <div className="text-center text-xs text-gray-400 mb-8 italic">Xaridingiz uchun rahmat! Yana kutib qolamiz.</div>
            
            {/* Bu tugmalar print qilinganda (qog'ozda) ko'rinmaydi */}
            <div className="flex gap-3 print:hidden">
              <button onClick={() => window.print()} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 transition-colors shadow-sm">
                🖨️ Chop etish
              </button>
              <button onClick={() => setSelectedReceipt(null)} className="flex-1 bg-gray-100 text-gray-800 py-2.5 rounded-lg font-semibold hover:bg-gray-200 transition-colors">
                Yopish
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}