"use client";
import { useState, useEffect } from "react";
import { supabase, GoldEngine, RBAC, logErpAudit } from "@/lib/erp-engine";

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [model, setModel] = useState("");
  const [proba, setProba] = useState("585");
  const [qty, setQty] = useState("10");
  const [gram, setGram] = useState("150");
  const [price, setPrice] = useState("95000000");
  const [advance, setAdvance] = useState("20000000");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (data) setOrders(data);
  };
  useEffect(() => { load(); }, []);

  const addOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !client) return alert("Mijoz ismini kiriting!");
    setBusy(true);
    const ordNo = `Z-${Math.floor(1000 + Math.random() * 9000)}`;
    const advNum = parseFloat(advance) || 0;
    const { data: newOrd, error } = await supabase.from("orders").insert([{
      order_no: ordNo, client_name: client, phone, product_model: model || "Komplekt",
      details: `${model || "Komplekt"} (${proba} proba, ${gram}g)`,
      proba: parseInt(proba) || 585, qty: parseInt(qty) || 10, weight_gram: parseFloat(gram) || 150,
      total_price: parseFloat(price) || 0, advance: advNum, deadline: deadline || null, priority, status: "Kutilmoqda"
    }]).select().single();

    if (!error && advNum > 0) {
      await supabase.from("sales").insert([{
        client_name: client, product_name: `Buyurtma Avansi (${ordNo})`, quantity: parseInt(qty) || 1,
        weight: parseFloat(gram) || 0, proba: parseInt(proba) || 585, payment_type: "Avans (Naqd)",
        total_amount: advNum, debt_amount: Math.max(0, (parseFloat(price) || 0) - advNum), tx_type: "kirim"
      }]);
    }
    await logErpAudit({ table: "orders", recordId: ordNo, action: "CREATE_ORDER", newData: newOrd });
    setClient(""); setPhone(""); setModel(""); setBusy(false); load();
  };

  // 3-BAND: ORDER -> BOM -> BATCH -> 25 STAGE WIP -> GOLD LEDGER CHAIN
  const launchProductionChain = async (ord: any) => {
    if (busy) return;
    if (!RBAC.can("create_batch")) return alert("Ruxsat yo'q! Faqat Production Manager yoki Supervisor partiya ocha oladi.");
    setBusy(true);
    const bNo = `P-${ord.order_no ? ord.order_no.replace("Z-", "") : Math.floor(100 + Math.random() * 900)}`;
    const qN = Number(ord.qty || 10), gN = Number(ord.weight_gram || 150), pN = Number(ord.proba || 585);

    const { data: nb, error } = await supabase.from("batches").insert([{
      order_id: ord.id, batch_no: bNo, product_name: ord.product_model || ord.details || "Komplekt",
      client_name: ord.client_name, master_name: "Valijon", proba: pN,
      planned_qty: qN, planned_gram: gN, actual_qty: qN, actual_gram: gN,
      issued_gold_gram: gN, wip_gram: gN, finished_qty: 0,
      current_step: "8. Quyish (Casting)", priority: ord.priority || "Normal", deadline: ord.deadline, status: "Jarayonda"
    }]).select().single();

    if (!error && nb) {
      await supabase.from("batch_stage_wip").insert([{
        batch_id: nb.id, batch_no: bNo, stage_order: 8, stage_name: "8. Quyish (Casting)",
        department: "Quyish", available_qty: qN, completed_qty: 0, input_weight: gN, queue_status: "NOW", assigned_worker: "Valijon"
      }]);
      await supabase.from("gold_transactions").insert([{
        transaction_type: "chiqim", from_location: "SAFE", to_location: "CASTING_WIP",
        material_name: `Order->Batch (${bNo})`, gross_weight: gN, proba: pN,
        pure_gold: GoldEngine.toFineGold(gN, pN), batch_no: bNo, description: `Order ${ord.order_no || ""} uchun SAFE -> CASTING`
      }]);
      await supabase.from("orders").update({ status: "Ishlab chiqarishda", batch_created: true }).eq("id", ord.id);
      await logErpAudit({ table: "orders", recordId: bNo, action: "ORDER_TO_BATCH_CHAIN", newData: { order: ord.order_no, batch: bNo, qN, gN } });
      alert(`Zanjir yaratildi: Buyurtma -> ${bNo} Partiya -> Quyish WIP (${qN} komplekt / ${gN}g) -> Gold Ledger!`);
    }
    setBusy(false); load();
  };

  const getDeadlineBadge = (dl: string) => {
    if (!dl) return <span className="text-slate-400">-</span>;
    const diffDays = Math.ceil((new Date(dl).getTime() - Date.now()) / (1000 * 3600 * 24));
    if (diffDays < 0) return <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold text-xs">🔴 CRITICAL ({dl})</span>;
    if (diffDays <= 3) return <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold text-xs">🟡 WARNING ({dl})</span>;
    return <span className="text-slate-700 font-semibold text-xs">{dl}</span>;
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Mijozlar va Buyurtmalar (Order → BOM → Batch Chain)</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={addOrder} className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit">
          <h2 className="font-bold border-b pb-2">Yangi Buyurtma (Avans avtomatik Kassaga tushadi)</h2>
          <input value={client} onChange={e => setClient(e.target.value)} placeholder="Mijoz ismi" className="w-full border rounded-xl p-2 font-bold" />
          <div className="grid grid-cols-2 gap-2">
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+998 90..." className="border rounded-xl p-2" />
            <select value={priority} onChange={e => setPriority(e.target.value)} className="border rounded-xl p-2 bg-white font-bold">
              <option value="Normal">NORMAL</option><option value="VIP">🟡 VIP</option><option value="URGENT">🔴 URGENT</option>
            </select>
          </div>
          <input value={model} onChange={e => setModel(e.target.value)} placeholder="Model / Komplekt nomi" className="w-full border rounded-xl p-2" />
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-[11px] text-slate-500">Proba</label><input type="number" value={proba} onChange={e => setProba(e.target.value)} className="w-full border rounded-xl p-2 font-bold" /></div>
            <div><label className="text-[11px] text-slate-500">Soni (dona)</label><input type="number" value={qty} onChange={e => setQty(e.target.value)} className="w-full border rounded-xl p-2 font-bold" /></div>
            <div><label className="text-[11px] text-slate-500">Vazni (gr)</label><input type="number" value={gram} onChange={e => setGram(e.target.value)} className="w-full border rounded-xl p-2 font-bold" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[11px] text-slate-500">Jami narx (so'm)</label><input type="number" value={price} onChange={e => setPrice(e.target.value)} className="w-full border rounded-xl p-2 font-bold" /></div>
            <div><label className="text-[11px] text-slate-500">Avans (so'm)</label><input type="number" value={advance} onChange={e => setAdvance(e.target.value)} className="w-full border rounded-xl p-2 font-bold text-emerald-700" /></div>
          </div>
          <div><label className="text-xs text-slate-500">Topshirish muddati (Deadline)</label><input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full border rounded-xl p-2 mt-1" /></div>
          <button type="submit" disabled={busy} className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-xl">Buyurtmani saqlash</button>
        </form>

        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs text-slate-500 bg-slate-50 border-b"><th className="p-2.5">Mijoz / Priority</th><th className="p-2.5">Model / Vazn</th><th className="p-2.5">Avans / Qoldiq Qarz</th><th className="p-2.5">Deadline</th><th className="p-2.5 text-center">Production Chain</th></tr></thead>
            <tbody>
              {orders.map((o, i) => {
                const rem = Math.max(0, Number(o.total_price || 78000000) - Number(o.advance || 0));
                return (
                  <tr key={i} className="border-b hover:bg-slate-50">
                    <td className="p-2.5"><b>{o.client_name || o.customer_name}</b> <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-bold">{o.priority || "NORMAL"}</span></td>
                    <td className="p-2.5"><b>{o.product_model || o.details}</b><div className="text-xs text-slate-500">{o.qty || 10} dona | {o.weight_gram || 120} gr ({o.proba || 585})</div></td>
                    <td className="p-2.5"><div className="text-emerald-600 font-bold">+{Number(o.advance || 0).toLocaleString()}</div><div className="text-xs text-red-600">Qoldiq: {rem.toLocaleString()}</div></td>
                    <td className="p-2.5">{getDeadlineBadge(o.deadline)}</td>
                    <td className="p-2.5 text-center">
                      {o.batch_created || o.status === "Ishlab chiqarishda" ? (
                        <span className="bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full text-xs font-bold">⚙️ Ishlab chiqarishda</span>
                      ) : (
                        <button onClick={() => launchProductionChain(o)} className="bg-purple-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg">⚙️ Partiya & WIP ochish →</button>
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
  );
}
