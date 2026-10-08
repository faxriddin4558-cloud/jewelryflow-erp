"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function ConsumptionPage() {
  const [list, setList] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [batchNo, setBatchNo] = useState("B-0010");
  const [master, setMaster] = useState("Valijon");
  const [dept, setDept] = useState("Quyish");
  const [proba, setProba] = useState("585");
  const [given, setGiven] = useState("");
  const [returned, setReturned] = useState("");
  const [sprue, setSprue] = useState("0");

  const load = async () => {
    const { data: cData } = await supabase.from("consumption").select("*").order("created_at", { ascending: false });
    if (cData) setList(cData);
    const { data: bData } = await supabase.from("batches").select("*");
    if (bData && bData.length > 0) setBatches(bData);
  };
  useEffect(() => { load(); }, []);

  const gNum = parseFloat(given) || 0;
  const rNum = parseFloat(returned) || 0;
  const sNum = parseFloat(sprue) || 0;
  // Haqiqiy yo'qotish (Pateriya) = Berildi - (Mahsulot + Sprue/Qoldiq)
  const lossNum = Number((gNum - rNum - sNum).toFixed(2));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!given || !returned) return alert("Berilgan va qaytgan vaznni kiriting!");

    const { error } = await supabase.from("consumption").insert([{
      batch_no: batchNo,
      master_name: master,
      department: dept,
      proba: parseInt(proba) || 585,
      given_weight: gNum,
      returned_weight: rNum,
      sprue_gram: sNum,
      loss_weight: lossNum
    }]);

    // Oltin tranzaksiyalari jurnaliga yo'qotishni ham yozib qo'yish (PRD 15-band)
    const pNum = parseInt(proba) || 585;
    if (lossNum > 0) {
      await supabase.from("gold_transactions").insert([{
        transaction_type: "yoqotish",
        material_name: `Pateriya (${dept} - ${batchNo})`,
        gross_weight: lossNum,
        proba: pNum,
        pure_gold: (lossNum * pNum) / 1000,
        batch_no: batchNo,
        description: `Usta: ${master} | Berildi: ${gNum}g, Mahsulot: ${rNum}g, Sprue: ${sNum}g`
      }]);
    }

    if (error) alert("Xatolik: " + error.message);
    else { setGiven(""); setReturned(""); setSprue("0"); load(); }
  };

  // Sprue / Qoldiqni Affinajga (Omborga) qaytarish
  const sendSprueToRefinery = async (item: any) => {
    const sp = Number(item.sprue_gram || 0);
    if (sp <= 0) return;
    const pr = Number(item.proba || 585);
    await supabase.from("gold_transactions").insert([{
      transaction_type: "kirim",
      material_name: `Sprue / Qoldiq (${item.batch_no || "Partiya"})`,
      gross_weight: sp,
      proba: pr,
      pure_gold: (sp * pr) / 1000,
      description: "Quyish/ishlovdan qaytgan qoldiq (Affinaj/Omborga)"
    }]);
    await supabase.from("consumption").update({ sent_to_refinery: true }).eq("id", item.id);
    alert(`${sp.toFixed(2)} gr Sprue/qoldiq Omborga (Affinaj uchun) qaytarildi!`);
    load();
  };

  const totalGiven = list.reduce((s, x) => s + Number(x.given_weight || x.given || 0), 0);
  const totalRet = list.reduce((s, x) => s + Number(x.returned_weight || x.returned || 0), 0);
  const totalLoss = list.reduce((s, x) => s + Number(x.loss_weight ?? (Number(x.given_weight || 0) - Number(x.returned_weight || 0))), 0);

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sarfiyat, Pateriya va Oltin Balansi</h1>
          <p className="text-xs text-slate-500 mt-1">Partiya bo'yicha berilgan oltin, chiqqan mahsulot, sprue/qoldiq va yo'qotishlar (PRD 15-band)</p>
        </div>
        <div className="flex gap-3 text-xs">
          <div className="bg-blue-50 border border-blue-200 px-3.5 py-2 rounded-xl">Berildi: <b className="text-blue-900">{totalGiven.toFixed(2)} gr</b></div>
          <div className="bg-emerald-50 border border-emerald-200 px-3.5 py-2 rounded-xl">Qaytdi: <b className="text-emerald-900">{totalRet.toFixed(2)} gr</b></div>
          <div className="bg-red-50 border border-red-200 px-3.5 py-2 rounded-xl">Jami Pateriya: <b className="text-red-700">{totalLoss.toFixed(2)} gr</b></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold mb-4 border-b pb-2">Oltin balansi va Pateriya kiritish</h2>
          <form onSubmit={handleSave} className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-600">Qaysi partiya?</label>
                <select value={batchNo} onChange={e => setBatchNo(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 bg-white font-bold">
                  <option value="B-0010">B-0010</option>
                  <option value="B-0002">B-0002</option>
                  {batches.map((b, i) => {
                    const bN = b.batch_no || b.number;
                    return bN ? <option key={i} value={bN}>{bN}</option> : null;
                  })}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Bo'lim</label>
                <select value={dept} onChange={e => setDept(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 bg-white font-semibold">
                  <option>Quyish</option><option>Zaklirovka</option><option>Sanding</option><option>Polirovka</option><option>Lazer</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-semibold text-slate-600">Mas'ul usta</label><input type="text" value={master} onChange={e => setMaster(e.target.value)} className="w-full border rounded-xl p-2 mt-1" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Proba</label><input type="number" value={proba} onChange={e => setProba(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-xs font-semibold text-slate-600">Berildi (gr)</label><input type="number" step="0.01" value={given} onChange={e => setGiven(e.target.value)} placeholder="1000" className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Mahsulot (gr)</label><input type="number" step="0.01" value={returned} onChange={e => setReturned(e.target.value)} placeholder="850" className="w-full border rounded-xl p-2 mt-1 font-bold text-emerald-700" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Sprue/Qoldiq</label><input type="number" step="0.01" value={sprue} onChange={e => setSprue(e.target.value)} placeholder="70" className="w-full border rounded-xl p-2 mt-1 font-bold text-amber-700" /></div>
            </div>

            <div className="bg-red-50 p-3 rounded-xl border border-red-200 flex justify-between items-center text-xs">
              <span className="text-red-800 font-semibold">Hisoblangan Pateriya (Yo'qotish):</span>
              <b className="text-red-600 text-base">{lossNum.toFixed(2)} gr</b>
            </div>

            <button type="submit" className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-xl shadow">Hisobotni saqlash</button>
          </form>
        </div>

        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold mb-4">Pateriya, Sprue va Oltin harakati tarixi</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                <th className="p-3">Partiya / Bo'lim</th>
                <th className="p-3">Usta</th>
                <th className="p-3">Berildi</th>
                <th className="p-3">Mahsulot / Sprue</th>
                <th className="p-3">Pateriya</th>
                <th className="p-3 text-center">Qoldiq harakati</th>
              </tr>
            </thead>
            <tbody>
              {list.map((it, i) => {
                const g = Number(it.given_weight || it.given || 0);
                const r = Number(it.returned_weight || it.returned || 0);
                const sp = Number(it.sprue_gram || 0);
                const l = Number(it.loss_weight ?? (g - r - sp));
                return (
                  <tr key={i} className="border-b hover:bg-slate-50">
                    <td className="p-3">
                      <b className="text-slate-900">{it.batch_no || it.batch || "B-0010"}</b>
                      <div className="text-xs text-slate-400">{it.department || "Quyish"} ({it.proba || 585})</div>
                    </td>
                    <td className="p-3 text-slate-700">{it.master_name || it.master || "Valijon"}</td>
                    <td className="p-3 font-semibold">{g.toFixed(2)} gr</td>
                    <td className="p-3">
                      <span className="font-bold text-emerald-600">{r.toFixed(2)} gr</span>
                      {sp > 0 && <div className="text-xs text-amber-600 font-semibold">Sprue: {sp.toFixed(2)} gr</div>}
                    </td>
                    <td className="p-3 font-extrabold text-red-600">{l.toFixed(2)} gr</td>
                    <td className="p-3 text-center">
                      {sp > 0 ? (
                        it.sent_to_refinery ? (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-bold">✓ Omborda</span>
                        ) : (
                          <button onClick={() => sendSprueToRefinery(it)} className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-2.5 py-1 rounded-lg">
                            ♻️ Affinajga
                          </button>
                        )
                      ) : <span className="text-xs text-slate-300">-</span>}
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