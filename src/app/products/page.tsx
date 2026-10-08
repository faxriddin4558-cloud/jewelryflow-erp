"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [cat, setCat] = useState("Komplekt");
  const [weight, setWeight] = useState("");
  const [proba, setProba] = useState("585");
  const [qty, setQty] = useState("1");
  const [stoneW, setStoneW] = useState("0");
  const [bom, setBom] = useState("Zirkon tosh, Dorika, Zanjir/Sim");
  const [price, setPrice] = useState("");
  const [imgUrl, setImgUrl] = useState("");

  const load = async () => {
    const { data } = await supabase.from("products").select("*").order("created_at", { ascending: false });
    if (data) setProducts(data);
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !weight) return alert("Mahsulot nomi va vaznini kiriting!");
    const { error } = await supabase.from("products").insert([{
      name,
      category: cat,
      weight: parseFloat(weight) || 0,
      proba: parseInt(proba) || 585,
      stock: parseInt(qty) || 1,
      quantity: parseInt(qty) || 1,
      stone_weight: parseFloat(stoneW) || 0,
      bom_details: bom,
      price: parseFloat(price) || 0,
      image_url: imgUrl || "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80"
    }]);
    if (error) alert("Xatolik: " + error.message);
    else { setName(""); setWeight(""); setPrice(""); setImgUrl(""); load(); }
  };

  const totalGoldGram = products.reduce((s, p) => s + Number(p.weight || 0) * Number(p.stock ?? p.quantity ?? 1), 0);
  const totalItems = products.reduce((s, p) => s + Number(p.stock ?? p.quantity ?? 0), 0);

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tayyor Mahsulotlar Ombori (Vitrina & BOM)</h1>
          <p className="text-xs text-slate-500 mt-1">Tayyor komplektlar, sof oltin/tosh vazni va ichki xomashyo sarfi (Dorika, Sim, Zanjir, Zirkon)</p>
        </div>
        <div className="flex gap-3 text-xs">
          <div className="bg-purple-50 border border-purple-200 px-4 py-2 rounded-xl">Jami Vitrinada: <b className="text-purple-900 text-sm">{totalItems} dona</b></div>
          <div className="bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl">Umumiy Oltin Vazni: <b className="text-amber-900 text-sm">{totalGoldGram.toFixed(2)} gr</b></div>
        </div>
      </div>

      {/* YANGI MAHSULOT VA BOM QO'SHISH */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h2 className="text-base font-bold text-slate-800 mb-4 border-b pb-2">💎 Yangi mahsulotni vitrinaga va texnologik katalogga (BOM) qo'shish</h2>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-3.5 text-sm">
          <div>
            <label className="text-xs font-semibold text-slate-600">Mahsulot / Komplekt nomi</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Masalan: Komplekt Amir" className="w-full border rounded-xl p-2.5 mt-1 font-semibold" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Toifasi</label>
            <select value={cat} onChange={e => setCat(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 bg-white font-semibold">
              <option>Komplekt (Uzuk+Zirak+Kulon)</option>
              <option>Uzuk</option><option>Zirak</option><option>Braslet / Zanjir</option><option>Kulon</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs font-semibold text-slate-600">Vazni (gr)</label><input type="number" step="0.01" value={weight} onChange={e => setWeight(e.target.value)} placeholder="12.50" className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
            <div><label className="text-xs font-semibold text-slate-600">Proba</label><input type="number" value={proba} onChange={e => setProba(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs font-semibold text-slate-600">Soni (Qoldiq)</label><input type="number" value={qty} onChange={e => setQty(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
            <div><label className="text-xs font-semibold text-slate-600">Tosh vazni (gr)</label><input type="number" step="0.01" value={stoneW} onChange={e => setStoneW(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1" /></div>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-slate-600">BOM / Ishlatilgan detallar (Dorika, Zanjir, Bezak simlari, Toshlar)</label>
            <input type="text" value={bom} onChange={e => setBom(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 text-xs bg-slate-50" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Rasm linki (ixtiyoriy)</label>
            <input type="text" value={imgUrl} onChange={e => setImgUrl(e.target.value)} placeholder="https://..." className="w-full border rounded-xl p-2.5 mt-1 text-xs" />
          </div>
          <div className="flex items-end">
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl shadow transition">
              + Vitrinaga qo'yish
            </button>
          </div>
        </form>
      </div>

      {/* VITRINA KATALOGI */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-4">🖼️ Mahsulotlar Katalogi va Texnologik Tarkibi</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {products.map((p, i) => {
            const count = Number(p.stock ?? p.quantity ?? 0);
            const w = Number(p.weight || 0);
            const pr = Number(p.proba || 585);
            const pureG = (w * pr) / 1000;
            return (
              <div key={i} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col justify-between hover:shadow-md transition">
                <div>
                  <div className="relative h-48 bg-slate-100">
                    <img
                      src={p.image_url || p.image || "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80"}
                      alt={p.name || "Zargarlik buyumi"}
                      className="w-full h-full object-cover"
                    />
                    <span className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-bold shadow ${count > 0 ? "bg-emerald-500 text-white" : "bg-red-500 text-white"}`}>
                      {count > 0 ? `${count} ta bor` : "Tugagan"}
                    </span>
                    <span className="absolute bottom-2 left-2 bg-slate-900/80 text-amber-400 px-2 py-0.5 rounded text-xs font-bold">
                      {pr} proba
                    </span>
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="text-[11px] font-bold uppercase text-indigo-600">{p.category || "Zargarlik buyumi"}</div>
                    <h3 className="font-bold text-slate-900 text-base">{p.name || p.title}</h3>
                    <div className="text-xs text-slate-600 flex justify-between border-t pt-2">
                      <span>Umumiy vazn: <b className="text-slate-900">{w.toFixed(2)} gr</b></span>
                      <span>Sof (999): <b className="text-amber-700">{pureG.toFixed(2)} gr</b></span>
                    </div>
                    {p.bom_details && (
                      <div className="text-[11px] bg-slate-50 p-2 rounded-lg border text-slate-500">
                        <b>Tarkibi (BOM):</b> {p.bom_details}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}