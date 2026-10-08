"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [model, setModel] = useState("");
  const [details, setDetails] = useState("");
  const [proba, setProba] = useState("585");
  const [qty, setQty] = useState("10");
  const [gram, setGram] = useState("150");
  const [price, setPrice] = useState("");
  const [advance, setAdvance] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState("Normal");

  const load = async () => {
    const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (data) setOrders(data);
  };
  useEffect(() => { load(); }, []);

  const addOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) return alert("Mijoz ismini kiriting!");
    const ordNo = `Z-${Math.floor(1000 + Math.random() * 9000)}`;
    const { error } = await supabase.from("orders").insert([{
      order_no: ordNo,
      client_name: client,
      phone,
      product_model: model || "Komplekt",
      details: details || `${model} (${proba} proba, ${gram}g)`,
      proba: parseInt(proba) || 585,
      qty: parseInt(qty) || 1,
      weight_gram: parseFloat(gram) || 0,
      total_price: parseFloat(price) || 0,
      advance: parseFloat(advance) || 0,
      deadline: deadline || null,
      priority,
      status: "Kutilmoqda"
    }]);
    if (error) alert("Xatolik: " + error.message);
    else { setClient(""); setPhone(""); setModel(""); setDetails(""); setPrice(""); setAdvance(""); load(); }
  };

  // Buyurtmadan avtomatik Partiya yaratish (PRD 21-band)
  const createBatchFromOrder = async (ord: any) => {
    const bNo = `P-${ord.order_no ? ord.order_no.replace("Z-", "") : Math.floor(100 + Math.random() * 900)}`;
    const { error } = await supabase.from("batches").insert([{
      batch_no: bNo,
      product_name: ord.product_model || ord.details || "Buyurtma komplekt",
      client_name: ord.client_name || ord.customer_name,
      master_name: "Valijon",
      proba: ord.proba || 585,
      planned_qty: ord.qty || 10,
      planned_gram: ord.weight_gram || 100,
      actual_qty: ord.qty || 10,
      actual_gram: ord.weight_gram || 100,
      current_step: "1. Model / dizayn",
      deadline: ord.deadline,
      status: "Jarayonda"
    }]);
    if (error) alert("Xatolik: " + error.message);
    else {
      await supabase.from("orders").update({ status: "Ishlab chiqarishda", batch_created: true }).eq("id", ord.id);
      alert(`Buyurtma asosida ${bNo} raqamli Partiya ochildi va Ishlab chiqarishga yuborildi!`);
      load();
    }
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Mijozlar va Buyurtmalar (Zakazlar)</h1>
        <p className="text-xs text-slate-500 mt-1">Buyurtma qabul qilish, avans/qarz hisobi va bir tugma bilan Partiyaga o'tkazish</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold mb-4 border-b pb-2">Yangi buyurtma (Zakaz)</h2>
          <form onSubmit={addOrder} className="space-y-3 text-sm">
            <div><label className="text-xs font-semibold text-slate-600">Mijozning ismi</label><input type="text" value={client} onChange={e => setClient(e.target.value)} placeholder="Masalan: Sardor aka" className="w-full border rounded-xl p-2.5 mt-1" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-semibold text-slate-600">Telefon</label><input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+998 90..." className="w-full border rounded-xl p-2 mt-1" /></div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Muhimligi</label>
                <select value={priority} onChange={e => setPriority(e.target.value)} className="w-full border rounded-xl p-2 mt-1 bg-white font-semibold">
                  <option>Normal</option><option>Shoshilinch (VIP)</option>
                </select>
              </div>
            </div>
            <div><label className="text-xs font-semibold text-slate-600">Mahsulot / Komplekt modeli</label><input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="Masalan: Komplekt Butterfly (15 model)" className="w-full border rounded-xl p-2 mt-1" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-xs font-semibold text-slate-600">Proba</label><input type="number" value={proba} onChange={e => setProba(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Soni (dona)</label><input type="number" value={qty} onChange={e => setQty(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Vazni (gr)</label><input type="number" step="0.01" value={gram} onChange={e => setGram(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-semibold text-slate-600">Umumiy narx (so'm)</label><input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="50000000" className="w-full border rounded-xl p-2 mt-1" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Avans (so'm)</label><input type="number" value={advance} onChange={e => setAdvance(e.target.value)} placeholder="10000000" className="w-full border rounded-xl p-2 mt-1" /></div>
            </div>
            <div><label className="text-xs font-semibold text-slate-600">Topshirish sanasi (Deadline)</label><input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full border rounded-xl p-2 mt-1" /></div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow">Buyurtmani qabul qilish</button>
          </form>
        </div>

        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold mb-4">Faol buyurtmalar ro'yxati</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                  <th className="p-3">Mijoz / Zakaz</th>
                  <th className="p-3">Model / Gramm</th>
                  <th className="p-3">Avans / Qoldiq</th>
                  <th className="p-3">Muddat</th>
                  <th className="p-3 text-center">Harakat (ERP)</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => {
                  const rem = Math.max(0, Number(o.total_price || 0) - Number(o.advance || 0));
                  return (
                    <tr key={i} className="border-b hover:bg-slate-50">
                      <td className="p-3">
                        <div className="font-bold text-slate-900">{o.client_name || o.customer_name}</div>
                        <div className="text-xs text-blue-600">{o.phone}</div>
                        {o.priority === "Shoshilinch (VIP)" && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">🔥 VIP</span>}
                      </td>
                      <td className="p-3">
                        <div className="font-semibold">{o.product_model || o.details}</div>
                        <div className="text-xs text-slate-500">{o.qty || 1} dona | {o.weight_gram || 0} gr ({o.proba || 585})</div>
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-emerald-600">+{Number(o.advance || 0).toLocaleString()}</div>
                        {rem > 0 && <div className="text-xs text-red-500">Qoldiq: {rem.toLocaleString()}</div>}
                      </td>
                      <td className="p-3 text-xs font-bold text-red-600">{o.deadline || "-"}</td>
                      <td className="p-3 text-center">
                        {o.batch_created || o.status === "Ishlab chiqarishda" ? (
                          <span className="bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full text-xs font-bold">⚙️ Partiyada</span>
                        ) : (
                          <button onClick={() => createBatchFromOrder(o)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm">
                            ⚙️ Partiya ochish →
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}