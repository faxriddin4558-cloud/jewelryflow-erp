"use client";
import { useState, useEffect } from "react";
import { supabase, GoldEngine, logErpAudit } from "@/lib/erp-engine";

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [bomItems, setBomItems] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [cat, setCat] = useState("Komplekt");
  const [proba, setProba] = useState("585");
  const [qty, setQty] = useState("5");
  const [ringW, setRingW] = useState("4.5");
  const [earW, setEarW] = useState("5.2");
  const [chainW, setChainW] = useState("3.3");
  const [dorikaW, setDorikaW] = useState("0.5");
  const [stoneW, setStoneW] = useState("1.0");
  const [bomVer, setBomVer] = useState("1");

  const load = async () => {
    const [p, b] = await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("bom_items").select("*")
    ]);
    if (p.data) setProducts(p.data);
    if (b.data) setBomItems(b.data);
  };
  useEffect(() => { load(); }, []);

  const totalSetWeight = Number(((parseFloat(ringW) || 0) + (parseFloat(earW) || 0) + (parseFloat(chainW) || 0) + (parseFloat(dorikaW) || 0) + (parseFloat(stoneW) || 0)).toFixed(2));

  const addProductWithBom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || totalSetWeight <= 0) return alert("Model nomi va BOM komponent vaznlarini kiriting!");
    const prN = parseInt(proba) || 585, verN = parseInt(bomVer) || 1;
    const summary = `v${verN}: Uzuk(${ringW}g) + Zirak(${earW}g) + Zanjir(${chainW}g) + Dorika(${dorikaW}g) + Tosh(${stoneW}g)`;

    const { data: newP } = await supabase.from("products").insert([{
      name, category: cat, weight: totalSetWeight, proba: prN, stock: parseInt(qty) || 1, quantity: parseInt(qty) || 1,
      stone_weight: parseFloat(stoneW) || 0, bom_version: verN, bom_details: summary,
      image_url: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80"
    }]).select().single();

    if (newP) {
      await supabase.from("bom_items").insert([
        { product_id: newP.id, product_name: name, bom_version: verN, component_name: "Ring (Uzuk)", material_category: "Gold", weight_per_set: parseFloat(ringW) || 0, proba: prN },
        { product_id: newP.id, product_name: name, bom_version: verN, component_name: "Earring (Zirak)", material_category: "Gold", weight_per_set: parseFloat(earW) || 0, proba: prN },
        { product_id: newP.id, product_name: name, bom_version: verN, component_name: "Chain/Wire (Zanjir/Sim)", material_category: "Wire", weight_per_set: parseFloat(chainW) || 0, proba: prN },
        { product_id: newP.id, product_name: name, bom_version: verN, component_name: "Dorika", material_category: "Wire", weight_per_set: parseFloat(dorikaW) || 0, proba: prN },
        { product_id: newP.id, product_name: name, bom_version: verN, component_name: "Zircon Stone (Tosh)", material_category: "Stone", weight_per_set: parseFloat(stoneW) || 0, proba: 0 }
      ]);
      await logErpAudit({ table: "bom_items", recordId: newP.id, action: "CREATE_BOM_V" + verN, newData: { name, totalSetWeight, summary } });
    }
    setName(""); load();
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Tayyor Mahsulotlar Ombori & Haqiqiy BOM (Component Versioning)</h1>
      <form onSubmit={addProductWithBom} className="bg-white p-5 rounded-2xl border space-y-3 text-sm">
        <h2 className="font-bold border-b pb-2">💎 Yangi Model va Strukturali BOM yaratish (Ring + Earring + Chain + Dorika + Stone)</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Model nomi (Komplekt A)" className="border rounded-xl p-2 font-bold" />
          <select value={cat} onChange={e => setCat(e.target.value)} className="border rounded-xl p-2 bg-white font-semibold"><option>Komplekt</option><option>Uzuk</option><option>Zirak</option><option>Braslet</option></select>
          <input type="number" value={proba} onChange={e => setProba(e.target.value)} placeholder="Proba (585)" className="border rounded-xl p-2 font-bold" />
          <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="Ombor Soni" className="border rounded-xl p-2 font-bold" />
          <input type="number" value={bomVer} onChange={e => setBomVer(e.target.value)} placeholder="BOM Version (1)" className="border rounded-xl p-2" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 bg-slate-50 p-3 rounded-xl border text-xs">
          <div><label className="font-bold">Uzuk (Ring gr)</label><input type="number" step="0.1" value={ringW} onChange={e => setRingW(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1 font-bold" /></div>
          <div><label className="font-bold">Zirak (Earring gr)</label><input type="number" step="0.1" value={earW} onChange={e => setEarW(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1 font-bold" /></div>
          <div><label className="font-bold">Zanjir/Sim (gr)</label><input type="number" step="0.1" value={chainW} onChange={e => setChainW(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1 font-bold" /></div>
          <div><label className="font-bold">Dorika (gr)</label><input type="number" step="0.1" value={dorikaW} onChange={e => setDorikaW(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1 font-bold" /></div>
          <div><label className="font-bold">Zirkon Tosh (gr)</label><input type="number" step="0.1" value={stoneW} onChange={e => setStoneW(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1 font-bold" /></div>
          <div className="flex items-end"><button type="submit" className="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg">+ BOM & Vitrina ({totalSetWeight}g)</button></div>
        </div>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {products.map((p, i) => {
          const w = Number(p.weight || 14.5), pr = Number(p.proba || 585), st = Number(p.stock ?? p.quantity ?? 5);
          const fine = GoldEngine.toFineGold(w - Number(p.stone_weight || 0), pr);
          return (
            <div key={i} className="bg-white p-4 rounded-2xl border space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">BOM v{p.bom_version || 1} | {pr} proba</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{st} dona bor</span>
              </div>
              <h3 className="font-bold text-lg">{p.name || p.title || "Komplekt"}</h3>
              <div className="text-xs flex justify-between border-t pt-2">
                <span>Jami vazn: <b>{w.toFixed(2)} gr</b></span>
                <span>Sof oltin (999): <b className="text-amber-700">{fine.toFixed(2)} gr</b></span>
              </div>
              <div className="text-[11px] bg-slate-50 p-2 rounded border text-slate-600">{p.bom_details || "Uzuk + Zirak + Zanjir + Dorika + Tosh"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
