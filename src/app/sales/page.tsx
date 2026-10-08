"use client";
import { useState, useEffect } from "react";
import { supabase, RBAC, logErpAudit } from "@/lib/erp-engine";

export default function SalesPage() {
  const [sales, setSales] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [client, setClient] = useState("");
  const [prodName, setProdName] = useState("Komplekt");
  const [qty, setQty] = useState("1");
  const [weight, setWeight] = useState("14.5");
  const [proba, setProba] = useState("585");
  const [payType, setPayType] = useState("Naqd pul");
  const [totalPrice, setTotalPrice] = useState("18500000");
  const [paidAmount, setPaidAmount] = useState("18500000");
  const [txType, setTxType] = useState<"kirim" | "chiqim">("kirim");
  const [receipt, setReceipt] = useState<any>(null);

  const load = async () => {
    const [s, p] = await Promise.all([
      supabase.from("sales").select("*").order("created_at", { ascending: false }),
      supabase.from("products").select("*")
    ]);
    if (s.data) setSales(s.data);
    if (p.data) setProducts(p.data);
  };
  useEffect(() => { load(); }, []);

  const totNum = parseFloat(totalPrice) || 0, paidNum = parseFloat(paidAmount) || 0;
  const remDebt = Math.max(0, totNum - paidNum);

  const handleSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!RBAC.can("edit_sales")) return alert("Ruxsat yo'q! Faqat Accountant yoki Director sotuv/kassa yoza oladi.");
    if (!client || totNum <= 0) return alert("Mijoz va summani to'g'ri kiriting!");
    if (paidNum > totNum) return alert("XATO (Payment Guard): To'langan summa umumiy narxdan katta bo'lishi mumkin emas!");

    const qNum = parseInt(qty) || 1;
    if (txType === "kirim") {
      const prodObj = products.find(p => (p.name || "").toLowerCase() === prodName.toLowerCase());
      if (prodObj) {
        const curStock = Number(prodObj.stock ?? prodObj.quantity ?? 0);
        if (qNum > curStock) return alert(`XATO (Negative Stock Guard): Vitrinada "${prodObj.name}" dan faqat ${curStock} dona bor!`);
        await supabase.from("products").update({ stock: curStock - qNum, quantity: curStock - qNum }).eq("id", prodObj.id);
      }
    }

    await supabase.from("sales").insert([{
      client_name: client, product_name: txType === "chiqim" ? "Kassa Xarajati (Chiqim)" : prodName,
      quantity: qNum, weight: parseFloat(weight) || 0, proba: parseInt(proba) || 585,
      payment_type: payType, total_amount: paidNum, debt_amount: txType === "kirim" ? remDebt : 0, tx_type: txType
    }]);
    await logErpAudit({ table: "sales", action: `SALE_${txType.toUpperCase()}`, newData: { client, prodName, paidNum, remDebt } });
    setClient(""); load();
  };

  const totalIn = sales.filter(s => s.tx_type !== "chiqim").reduce((a, b) => a + Number(b.total_amount || 0), 0);
  const totalOut = sales.filter(s => s.tx_type === "chiqim").reduce((a, b) => a + Number(b.total_amount || 0), 0);
  const totalDebt = sales.reduce((a, b) => a + Number(b.debt_amount || 0), 0);

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Sotuv, Kassa va Qarzlar (Vitrina bilan bog'langan)</h1>
        <div className="flex gap-3 text-xs">
          <div className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl">Kassa Balans: <b className="text-emerald-900 text-sm">{(totalIn - totalOut).toLocaleString()} so'm</b></div>
          <div className="bg-red-50 border border-red-200 px-4 py-2 rounded-xl">Qarzlar: <b className="text-red-900 text-sm">{totalDebt.toLocaleString()} so'm</b></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSale} className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit">
          <div className="flex gap-2 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button type="button" onClick={() => setTxType("kirim")} className={`flex-1 py-2 rounded-lg ${txType === "kirim" ? "bg-emerald-600 text-white" : ""}`}>➕ Sotuv (Kirim)</button>
            <button type="button" onClick={() => setTxType("chiqim")} className={`flex-1 py-2 rounded-lg ${txType === "chiqim" ? "bg-red-600 text-white" : ""}`}>➖ Xarajat (Chiqim)</button>
          </div>
          <input value={client} onChange={e => setClient(e.target.value)} placeholder={txType === "kirim" ? "Xaridor ismi" : "Xarajat sababi"} className="w-full border rounded-xl p-2 font-bold" />
          {txType === "kirim" && (
            <>
              <input list="p-list" value={prodName} onChange={e => setProdName(e.target.value)} placeholder="Mahsulot nomi" className="w-full border rounded-xl p-2" />
              <datalist id="p-list">{products.map((p, i) => <option key={i} value={p.name} />)}</datalist>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[11px] text-slate-500">Soni</label><input type="number" value={qty} onChange={e => setQty(e.target.value)} className="w-full border rounded-xl p-2 font-bold" /></div>
                <div><label className="text-[11px] text-slate-500">Vazn (gr)</label><input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} className="w-full border rounded-xl p-2 font-bold" /></div>
                <div><label className="text-[11px] text-slate-500">Proba</label><input type="number" value={proba} onChange={e => setProba(e.target.value)} className="w-full border rounded-xl p-2 font-bold" /></div>
              </div>
            </>
          )}
          <select value={payType} onChange={e => setPayType(e.target.value)} className="w-full border rounded-xl p-2 bg-white font-semibold">
            <option>Naqd pul</option><option>Karta (Terminal)</option><option>Qarzga / Bo'lib to'lash</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[11px] text-slate-500">Jami narx (TOTAL)</label><input type="number" value={totalPrice} onChange={e => { setTotalPrice(e.target.value); setPaidAmount(e.target.value); }} className="w-full border rounded-xl p-2 font-bold" /></div>
            <div><label className="text-[11px] text-emerald-700 font-bold">To'landi (PAID)</label><input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} className="w-full border-2 border-emerald-500 rounded-xl p-2 font-bold" /></div>
          </div>
          {txType === "kirim" && (
            <div className="bg-red-50 p-2.5 rounded-xl border border-red-200 flex justify-between text-xs">
              <span className="font-bold text-red-800">Qolgan Qarz (REMAINING):</span>
              <b className="text-red-600 text-sm">{remDebt.toLocaleString()} so'm</b>
            </div>
          )}
          <button type="submit" className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-xl">Tasdiqlash</button>
        </form>

        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border">
          <h2 className="font-bold mb-3">Sotuv va Kassa Tarixi</h2>
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs text-slate-500 bg-slate-50 border-b"><th className="p-2.5">Mijoz</th><th className="p-2.5">Mahsulot</th><th className="p-2.5">To'landi / Qarz</th><th className="p-2.5 text-center">Chek</th></tr></thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2.5 font-bold">{s.client_name}</td>
                  <td className="p-2.5">{s.product_name} ({s.weight || 0}g / {s.proba || 585})</td>
                  <td className="p-2.5">
                    <span className={`font-bold ${s.tx_type === "chiqim" ? "text-red-600" : "text-emerald-600"}`}>{s.tx_type === "chiqim" ? "-" : "+"}{Number(s.total_amount || 0).toLocaleString()} so'm</span>
                    {s.debt_amount > 0 && <div className="text-xs text-red-500 font-semibold">Qarz: {Number(s.debt_amount).toLocaleString()} so'm</div>}
                  </td>
                  <td className="p-2.5 text-center"><button onClick={() => setReceipt(s)} className="border bg-blue-50 text-blue-700 px-2.5 py-1 rounded text-xs font-bold">🧾 Chek</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {receipt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl max-w-sm w-full space-y-3 border shadow-2xl text-xs">
            <h3 className="font-black text-base text-center border-b pb-2">💎 JEWELRYFLOW ERP — CHEK</h3>
            <div className="flex justify-between"><span>Mijoz:</span><b>{receipt.client_name}</b></div>
            <div className="flex justify-between"><span>Mahsulot:</span><b>{receipt.product_name} ({receipt.weight}g)</b></div>
            <div className="flex justify-between"><span>To'landi:</span><b className="text-emerald-700">{Number(receipt.total_amount).toLocaleString()} so'm</b></div>
            <div className="flex justify-between"><span>Qolgan qarz:</span><b className="text-red-600">{Number(receipt.debt_amount || 0).toLocaleString()} so'm</b></div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => window.print()} className="flex-1 bg-blue-600 text-white py-2 rounded-xl font-bold">🖨️ Print</button>
              <button onClick={() => setReceipt(null)} className="flex-1 bg-slate-200 py-2 rounded-xl font-bold">Yopish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
