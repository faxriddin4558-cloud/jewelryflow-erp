"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function CalculatorPage() {
  const [w, setW] = useState("100");
  const [cP, setCP] = useState("999");
  const [tP, setTP] = useState("585");
  const [ratio, setRatio] = useState("70");

  const [sW, setSW] = useState("400");
  const [sP, setSP] = useState("585");
  const [src, setSrc] = useState("Lom / Qirindi");
  const [reag, setReag] = useState("Mis + Azot kislotasi");
  const [outW, setOutW] = useState("");
  const [outP, setOutP] = useState("999");
  const [resp, setResp] = useState("Valijon");
  const [list, setList] = useState<any[]>([]);

  const wN = parseFloat(w) || 0, cN = parseFloat(cP) || 0, tN = parseFloat(tP) || 585, rN = parseFloat(ratio) || 70;
  const pure = (wN * cN) / 1000;
  const totalAlloy = tN > 0 ? (wN * cN) / tN : 0;
  const ligatura = Math.max(0, totalAlloy - wN);

  const swN = parseFloat(sW) || 0, spN = parseFloat(sP) || 0;
  const expPure = (swN * spN) / 1000;
  const actualW = outW !== "" ? parseFloat(outW) : expPure;
  const opN = parseFloat(outP) || 999;
  const actPure = (actualW * opN) / 1000;
  const loss = Math.max(0, expPure - actPure);

  const load = async () => {
    const { data } = await supabase.from("gold_transactions").select("*").eq("transaction_type", "affinaj").order("created_at", { ascending: false });
    if (data) setList(data);
  };
  useEffect(() => { load(); }, []);

  const saveAffinaj = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from("gold_transactions").insert([
      { transaction_type: "affinaj", material_name: `${src} -> Oltin (${opN})`, gross_weight: actualW, proba: opN, pure_gold: actPure, description: `Kirdi: ${swN}g (${spN}) | Reagent: ${reag} | Yo'qotish: ${loss.toFixed(2)}g | Mas'ul: ${resp}` },
      { transaction_type: "kirim", material_name: "Toza oltin (Affinaj)", gross_weight: actualW, proba: opN, pure_gold: actPure, description: `Affinajdan kirim (${resp})` }
    ]);
    alert(`Saqlandi! Omborga ${actualW.toFixed(2)} gr (${opN} proba) kirim qilindi.`);
    setOutW(""); load();
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Proba, Ligatura va Affinaj Markazi</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          <h2 className="text-lg font-bold border-b pb-2">⚖️ Proba tushirish (Qotishma & Ligatura)</h2>
          <div className="space-y-3 text-sm">
            <div><label className="text-xs font-semibold text-slate-600">Tilla massasi (gr)</label><input type="number" value={w} onChange={e => setW(e.target.value)} className="w-full border rounded-xl p-2.5 font-bold mt-1" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-semibold text-slate-600">Joriy proba</label><input type="number" value={cP} onChange={e => setCP(e.target.value)} className="w-full border rounded-xl p-2.5 font-bold mt-1" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Kutilayotgan proba</label><input type="number" value={tP} onChange={e => setTP(e.target.value)} className="w-full border rounded-xl p-2.5 font-bold mt-1" /></div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Nisbat: {rN}% yangi / {100 - rN}% eski oltin</label>
              <input type="range" min="0" max="100" step="5" value={ratio} onChange={e => setRatio(e.target.value)} className="w-full mt-1" />
            </div>
          </div>
          <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 space-y-2 text-sm">
            <div className="flex justify-between"><span>Sof oltin (999.9):</span><b className="text-amber-700">{pure.toFixed(2)} gr</b></div>
            <div className="flex justify-between border-t border-amber-200 pt-2"><span>Qo'shiladigan ligatura (Mis/Rux):</span><b className="text-amber-800 text-base">+{ligatura.toFixed(2)} gr</b></div>
            <div className="flex justify-between border-t border-amber-200 pt-2"><span>Jami tayyor qotishma ({tN}):</span><b className="text-emerald-700 text-base">{totalAlloy.toFixed(2)} gr</b></div>
            <div className="text-xs bg-white p-2 rounded border">Tavsiya: {((totalAlloy * rN) / 100).toFixed(2)}g yangi + {((totalAlloy * (100 - rN)) / 100).toFixed(2)}g eski</div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          <h2 className="text-lg font-bold border-b pb-2">🧪 Tillani tozalash (Affinaj)</h2>
          <form onSubmit={saveAffinaj} className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-semibold text-slate-600">Lom / Qirindi (gr)</label><input type="number" value={sW} onChange={e => setSW(e.target.value)} className="w-full border rounded-xl p-2 font-bold mt-1" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Taxminiy probasi</label><input type="number" value={sP} onChange={e => setSP(e.target.value)} className="w-full border rounded-xl p-2 font-bold mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-semibold text-slate-600">Manbasi</label><input type="text" value={src} onChange={e => setSrc(e.target.value)} className="w-full border rounded-xl p-2 text-xs mt-1" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Reagentlar</label><input type="text" value={reag} onChange={e => setReag(e.target.value)} className="w-full border rounded-xl p-2 text-xs mt-1" /></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-xs font-semibold text-slate-600">Chiqdi (gr)</label><input type="number" step="0.01" value={outW} onChange={e => setOutW(e.target.value)} placeholder={expPure.toFixed(2)} className="w-full border border-emerald-400 rounded-xl p-2 font-bold mt-1" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Proba</label><input type="number" value={outP} onChange={e => setOutP(e.target.value)} className="w-full border rounded-xl p-2 font-bold mt-1" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Mas'ul</label><input type="text" value={resp} onChange={e => setResp(e.target.value)} className="w-full border rounded-xl p-2 mt-1" /></div>
            </div>
            <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 space-y-1 text-xs">
              <div className="flex justify-between"><span>Olinadigan sof tilla (999):</span><b className="text-blue-800 text-sm">{expPure.toFixed(2)} gr</b></div>
              <div className="flex justify-between"><span>Ajraladigan aralashma (mis, rux):</span><b className="text-red-600">{Math.max(0, swN - expPure).toFixed(2)} gr</b></div>
              <div className="flex justify-between border-t border-blue-200 pt-1 text-amber-800"><span>Affinaj yo'qotishi (Pateriya):</span><b>{loss.toFixed(2)} gr</b></div>
            </div>
            <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow">🧪 Affinajni yakunlash va Omborga kirim qilish</button>
          </form>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="font-bold mb-3">Affinaj amaliyotlari tarixi</h3>
        <table className="w-full text-left text-sm">
          <thead><tr className="text-xs text-slate-500 uppercase bg-slate-50 border-b"><th className="p-2">Sana</th><th className="p-2">Amaliyot</th><th className="p-2 text-right">Massa</th><th className="p-2">Tafsilotlar</th></tr></thead>
          <tbody>
            {list.map((it, i) => (
              <tr key={i} className="border-b"><td className="p-2 text-xs">{new Date(it.created_at).toLocaleDateString("uz-UZ")}</td><td className="p-2 font-semibold">{it.material_name}</td><td className="p-2 text-right font-bold text-emerald-600">{Number(it.gross_weight).toFixed(2)} gr</td><td className="p-2 text-xs text-slate-600">{it.description}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}