"use client";
import { useState, useEffect } from "react";
import { supabase, GoldEngine, RBAC, logErpAudit } from "@/lib/erp-engine";

const CATEGORIES = ["Gold", "Alloy", "Silver", "Copper", "Wax", "Resin", "Investment", "Stone", "Chain", "Wire", "Other"];

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [cat, setCat] = useState("Gold");
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState("gr");
  const [proba, setProba] = useState("999");
  const [txType, setTxType] = useState<"kirim" | "chiqim" | "reserve">("kirim");
  const [fromLoc, setFromLoc] = useState("SUPPLIER");
  const [toLoc, setToLoc] = useState("SAFE");
  const [reason, setReason] = useState("");

  const load = async () => {
    const [iRes, lRes] = await Promise.all([
      supabase.from("inventory_items").select("*").order("category"),
      supabase.from("gold_transactions").select("*").order("created_at", { ascending: false }).limit(20)
    ]);
    if (iRes.data) setItems(iRes.data);
    if (lRes.data) setLedger(lRes.data);
  };
  useEffect(() => { load(); }, []);

  const handleTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!RBAC.can("edit_inventory")) return alert("Ruxsat yo'q! Faqat Warehouse yoki Director o'zgartira oladi.");
    const wNum = parseFloat(weight) || 0, pNum = parseInt(proba) || 0;
    if (!name || wNum <= 0) return alert("Nomi va 0 dan katta miqdorni kiriting!");

    const ex = items.find(x => (x.name || "").toLowerCase() === name.toLowerCase() && Number(x.proba) === pNum);
    const onH = ex ? Number(ex.on_hand) : 0, res = ex ? Number(ex.reserved) : 0, avail = onH - res;
    if ((txType === "chiqim" || txType === "reserve") && wNum > avail) {
      return alert(`XATO (Negative Inventory Guard): Omborda faqat ${avail.toFixed(2)} ${unit} AVAILABLE bor!`);
    }

    if (ex) {
      await supabase.from("inventory_items").update({
        on_hand: txType === "kirim" ? onH + wNum : txType === "chiqim" ? onH - wNum : onH,
        reserved: txType === "reserve" ? res + wNum : res
      }).eq("id", ex.id);
    } else {
      await supabase.from("inventory_items").insert([{
        material_code: `M-${Math.floor(100 + Math.random() * 900)}`, name, category: cat, unit, proba: pNum, on_hand: wNum, reserved: 0
      }]);
    }

    await supabase.from("gold_transactions").insert([{
      transaction_type: txType, from_location: txType === "kirim" ? fromLoc : "SAFE", to_location: txType === "kirim" ? "SAFE" : toLoc,
      material_name: name, gross_weight: wNum, proba: pNum, pure_gold: GoldEngine.toFineGold(wNum, pNum), description: reason || `${txType}: ${fromLoc}->${toLoc}`
    }]);
    await logErpAudit({ table: "inventory_items", action: txType.toUpperCase(), newData: { name, wNum, pNum } });
    setName(""); setWeight(""); setReason(""); load();
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Xomashyo Ombori (ON HAND / RESERVED / AVAILABLE) & Gold Ledger</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleTx} className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit">
          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button type="button" onClick={() => setTxType("kirim")} className={`py-2 rounded-lg ${txType === "kirim" ? "bg-emerald-600 text-white" : ""}`}>+ Kirim</button>
            <button type="button" onClick={() => setTxType("chiqim")} className={`py-2 rounded-lg ${txType === "chiqim" ? "bg-red-600 text-white" : ""}`}>- Chiqim</button>
            <button type="button" onClick={() => setTxType("reserve")} className={`py-2 rounded-lg ${txType === "reserve" ? "bg-amber-600 text-white" : ""}`}>🔒 Rezerv</button>
          </div>
          <select value={cat} onChange={e => setCat(e.target.value)} className="w-full border rounded-xl p-2 bg-white font-bold">{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Material nomi (Toza oltin 988)" className="w-full border rounded-xl p-2 font-bold" />
          <div className="grid grid-cols-3 gap-2">
            <input type="number" step="0.01" value={weight} onChange={e => setWeight(e.target.value)} placeholder="Miqdor" className="border rounded-xl p-2 font-bold" />
            <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="gr/dona" className="border rounded-xl p-2" />
            <input type="number" value={proba} onChange={e => setProba(e.target.value)} placeholder="Proba" className="border rounded-xl p-2 font-bold" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={fromLoc} onChange={e => setFromLoc(e.target.value)} placeholder="From (SAFE)" className="border rounded-xl p-2 text-xs" />
            <input value={toLoc} onChange={e => setToLoc(e.target.value)} placeholder="To (CASTING)" className="border rounded-xl p-2 text-xs" />
          </div>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Sabab / Partiya No" className="w-full border rounded-xl p-2 text-xs" />
          <button type="submit" className="w-full bg-orange-600 text-white font-bold py-2.5 rounded-xl">Tasdiqlash</button>
        </form>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-5 rounded-2xl border">
            <h2 className="font-bold mb-3">Real Qoldiqlar (ON HAND / RESERVED / AVAILABLE)</h2>
            <table className="w-full text-left text-sm">
              <thead><tr className="text-xs text-slate-500 bg-slate-50 border-b"><th className="p-2">Material</th><th className="p-2 text-right">ON HAND</th><th className="p-2 text-right">RESERVED</th><th className="p-2 text-right">AVAILABLE</th><th className="p-2 text-right">Fine Gold (999)</th></tr></thead>
              <tbody>
                {items.map((it, i) => {
                  const onH = Number(it.on_hand || 0), res = Number(it.reserved || 0), av = Math.max(0, onH - res);
                  return (
                    <tr key={i} className="border-b">
                      <td className="p-2"><b>{it.name}</b> <span className="text-xs text-slate-400">({it.category} / {it.proba})</span></td>
                      <td className="p-2 text-right font-semibold">{onH.toFixed(2)} {it.unit}</td>
                      <td className="p-2 text-right text-amber-600">{res.toFixed(2)}</td>
                      <td className="p-2 text-right font-black text-emerald-600">{av.toFixed(2)} {it.unit}</td>
                      <td className="p-2 text-right font-bold text-amber-700">{GoldEngine.toFineGold(onH, it.proba).toFixed(2)} g</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-white p-5 rounded-2xl border">
            <h3 className="font-bold text-sm mb-2">🔗 Gold Movement Ledger (SAFE → CASTING → WIP → AFFINAJ)</h3>
            <table className="w-full text-left text-xs">
              <thead><tr className="bg-slate-50 border-b"><th className="p-2">Sana</th><th className="p-2">Yo'nalish</th><th className="p-2">Material</th><th className="p-2 text-right">Massa</th><th className="p-2 text-right">Sof 999</th></tr></thead>
              <tbody>{ledger.map((l, i) => <tr key={i} className="border-b"><td className="p-2">{new Date(l.created_at).toLocaleDateString("uz-UZ")}</td><td className="p-2 font-bold text-blue-700">{l.from_location || "SAFE"} → {l.to_location || "WIP"}</td><td className="p-2">{l.material_name}</td><td className="p-2 text-right font-bold">{Number(l.gross_weight || 0).toFixed(2)}g ({l.proba})</td><td className="p-2 text-right font-bold text-amber-700">{Number(l.pure_gold || 0).toFixed(2)}g</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
