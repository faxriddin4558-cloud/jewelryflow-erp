"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function SalesPage() {
  const [sales, setSales] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [client, setClient] = useState("");
  const [prodName, setProdName] = useState("Komplekt");
  const [qty, setQty] = useState("1");
  const [weight, setWeight] = useState("");
  const [proba, setProba] = useState("585");
  const [payType, setPayType] = useState("Naqd pul");
  const [amount, setAmount] = useState("");
  const [debt, setDebt] = useState("0");
  const [txType, setTxType] = useState("kirim");
  const [receipt, setReceipt] = useState<any | null>(null);

  const load = async () => {
    const { data: sData } = await supabase.from("sales").select("*").order("created_at", { ascending: false });
    if (sData) setSales(sData);
    const { data: pData } = await supabase.from("products").select("*");
    if (pData) setProducts(pData);
  };
  useEffect(() => { load(); }, []);

  const handleSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !amount) return alert("Mijoz/Izoh va summani kiriting!");
    const { error } = await supabase.from("sales").insert([{
      client_name: client,
      product_name: txType === "chiqim" ? "Kassa Xarajati (Chiqim)" : prodName,
      quantity: parseInt(qty) || 1,
      weight: parseFloat(weight) || 0,
      proba: parseInt(proba) || 585,
      payment_type: payType,
      total_amount: parseFloat(amount) || 0,
      debt_amount: parseFloat(debt) || 0,
      tx_type: txType
    }]);
    if (error) alert("Xatolik: " + error.message);
    else { setClient(""); setWeight(""); setAmount(""); setDebt("0"); load(); }
  };

  const totalIn = sales.filter(s => s.tx_type !== "chiqim").reduce((a, b) => a + Number(b.total_amount || b.amount || 0), 0);
  const totalOut = sales.filter(s => s.tx_type === "chiqim").reduce((a, b) => a + Number(b.total_amount || b.amount || 0), 0);
  const totalDebt = sales.reduce((a, b) => a + Number(b.debt_amount || 0), 0);

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sotuv va Kassa Boshqaruvi</h1>
          <p className="text-xs text-slate-500 mt-1">Tayyor mahsulot sotuvi, naqd/karta/qarz hisobi, kassa chiqimlari va chek chiqarish</p>
        </div>
        <div className="flex gap-3 text-xs">
          <div className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl"><span className="text-emerald-700">Kassa Balans:</span> <b className="text-emerald-900 text-sm">{(totalIn - totalOut).toLocaleString()} so'm</b></div>
          <div className="bg-red-50 border border-red-200 px-4 py-2 rounded-xl"><span className="text-red-700">Mijozlar qarzi:</span> <b className="text-red-900 text-sm">{totalDebt.toLocaleString()} so'm</b></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-fit">
          <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button onClick={() => setTxType("kirim")} className={`flex-1 py-2 rounded-lg ${txType === "kirim" ? "bg-emerald-600 text-white" : "text-slate-600"}`}>➕ Sotuv (Kirim)</button>
            <button onClick={() => setTxType("chiqim")} className={`flex-1 py-2 rounded-lg ${txType === "chiqim" ? "bg-red-600 text-white" : "text-slate-600"}`}>➖ Xarajat (Chiqim)</button>
          </div>

          <form onSubmit={handleSale} className="space-y-3 text-sm">
            <div><label className="text-xs font-semibold text-slate-600">{txType === "kirim" ? "Xaridor (Mijoz)" : "Xarajat sababi / Kimga"}</label><input type="text" value={client} onChange={e => setClient(e.target.value)} placeholder={txType === "kirim" ? "Mijoz ismi" : "Masalan: Reagent olindi"} className="w-full border rounded-xl p-2.5 mt-1" /></div>
            {txType === "kirim" && (
              <>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Qaysi mahsulot?</label>
                  <input type="text" list="prod-list" value={prodName} onChange={e => setProdName(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1" />
                  <datalist id="prod-list">
                    <option value="Komplekt" /><option value="Uzuk" /><option value="Zirak" /><option value="Braslet" />
                    {products.map((p, i) => <option key={i} value={p.name || p.title} />)}
                  </datalist>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="text-xs font-semibold text-slate-600">Soni</label><input type="number" value={qty} onChange={e => setQty(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
                  <div><label className="text-xs font-semibold text-slate-600">Vazni (gr)</label><input type="number" step="0.01" value={weight} onChange={e => setWeight(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
                  <div><label className="text-xs font-semibold text-slate-600">Proba</label><input type="number" value={proba} onChange={e => setProba(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-600">To'lov turi</label>
                <select value={payType} onChange={e => setPayType(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 bg-white">
                  <option>Naqd pul</option><option>Karta (Terminal)</option><option>O'tkazma</option><option>Qarzga / Bo'lib to'lash</option>
                </select>
              </div>
              <div><label className="text-xs font-semibold text-slate-600">To'langan Summa</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
            </div>
            {txType === "kirim" && (
              <div><label className="text-xs font-semibold text-red-600">Qolgan qarz summasi (agar qarzga bo'lsa)</label><input type="number" value={debt} onChange={e => setDebt(e.target.value)} className="w-full border border-red-200 rounded-xl p-2 mt-1" /></div>
            )}
            <button type="submit" className={`w-full font-bold py-3 rounded-xl text-white shadow ${txType === "kirim" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}>
              {txType === "kirim" ? "Sotuvni tasdiqlash" : "Chiqimni saqlash"}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold mb-4">So'nggi sotuvlar va Kassa tarixi</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                <th className="p-3">Xaridor / Izoh</th>
                <th className="p-3">Mahsulot / Vazn</th>
                <th className="p-3">To'lov / Summa</th>
                <th className="p-3 text-center">Harakat</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => {
                const isOut = s.tx_type === "chiqim";
                return (
                  <tr key={i} className="border-b hover:bg-slate-50">
                    <td className="p-3 font-bold">{s.client_name || s.customer_name}</td>
                    <td className="p-3 text-slate-600">{s.product_name || s.product} ({s.weight || 0}gr / {s.proba || 585})</td>
                    <td className="p-3">
                      <span className={`font-extrabold ${isOut ? "text-red-600" : "text-emerald-600"}`}>
                        {isOut ? "-" : "+"}{Number(s.total_amount || s.amount || 0).toLocaleString()} so'm
                      </span>
                      <div className="text-[11px] text-slate-400">{s.payment_type} {s.debt_amount > 0 ? `| Qarz: ${Number(s.debt_amount).toLocaleString()}` : ""}</div>
                    </td>
                    <td className="p-3 text-center">
                      <button onClick={() => setReceipt(s)} className="border border-blue-200 bg-blue-50 text-blue-700 px-3 py-1 rounded-lg text-xs font-bold">🧾 Chek</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {receipt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl max-w-sm w-full space-y-4 border shadow-2xl text-sm">
            <div className="text-center border-b pb-3">
              <h3 className="font-black text-lg">💎 JEWELRYFLOW ERP</h3>
              <p className="text-xs text-slate-500">Rasmiy Savdo Cheki</p>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span>Xaridor:</span><b>{receipt.client_name || receipt.customer_name}</b></div>
              <div className="flex justify-between"><span>Mahsulot:</span><b>{receipt.product_name || receipt.product}</b></div>
              <div className="flex justify-between"><span>Vazni / Proba:</span><b>{receipt.weight || 0} gr ({receipt.proba || 585})</b></div>
              <div className="flex justify-between"><span>To'lov turi:</span><b>{receipt.payment_type}</b></div>
              <div className="flex justify-between text-sm border-t pt-2"><span>Jami to'landi:</span><b className="text-emerald-700">{Number(receipt.total_amount || receipt.amount || 0).toLocaleString()} so'm</b></div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => window.print()} className="flex-1 bg-blue-600 text-white py-2 rounded-xl font-bold text-xs">🖨️ Chop etish</button>
              <button onClick={() => setReceipt(null)} className="flex-1 bg-slate-200 text-slate-800 py-2 rounded-xl font-bold text-xs">Yopish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}