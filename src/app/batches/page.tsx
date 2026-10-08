"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");

const OPS = [
  "1. Model / dizayn", "2. Rezina / vosk", "3. Vosk ishlash", "4. Vosk daraxti", "5. Gipslash",
  "6. Burnout / pech", "7. Quyish", "8. Zaklirovka", "9. Rigel", "10. Sanding",
  "11. Ponza / galtovka", "12. Igna tozalash", "13. Chotka", "14. Tozalash (1)", "15. Zircon",
  "16. Tozalash (2)", "17. Yakuniy polirovka", "18. Lazer / payka", "19. Qo'l polirovka", "20. Moyka",
  "21. Yig'ish", "22. Sanash", "23. QC / sifat", "24. Tayyor ombor", "25. Sotuv"
];

export default function BatchesPage() {
  const [tab, setTab] = useState("list");
  const [batches, setBatches] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [bNo, setBNo] = useState("");
  const [prod, setProd] = useState("");
  const [master, setMaster] = useState("Valijon");
  const [proba, setProba] = useState("585");
  const [pQty, setPQty] = useState("10");
  const [pGram, setPGram] = useState("500");
  const [opGram, setOpGram] = useState("");
  const [opQty, setOpQty] = useState("");

  const load = async () => {
    const { data: b } = await supabase.from("batches").select("*").order("created_at", { ascending: false });
    const { data: m } = await supabase.from("machines").select("*").order("name");
    if (b) setBatches(b);
    if (m) setMachines(m);
  };
  useEffect(() => { load(); }, []);

  const isDone = (s: string) => s === "Tugatildi" || (s || "").toLowerCase() === "completed";

  const createBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bNo || !prod) return alert("Ma'lumotlarni kiriting!");
    await supabase.from("batches").insert([{
      batch_no: bNo, product_name: prod, master_name: master, status: "Jarayonda",
      proba: parseInt(proba) || 585, planned_qty: parseInt(pQty) || 10, planned_gram: parseFloat(pGram) || 0,
      actual_qty: parseInt(pQty) || 10, actual_gram: parseFloat(pGram) || 0, current_step: "7. Quyish", route_steps: OPS
    }]);
    setBNo(""); setProd(""); load();
  };

  const nextStep = async (b: any) => {
    const idx = OPS.indexOf(b.current_step || "7. Quyish");
    const next = idx >= 0 && idx < OPS.length - 1 ? OPS[idx + 1] : "24. Tayyor ombor";
    const done = next.includes("Tayyor") || next.includes("Sotuv");
    const nG = opGram ? parseFloat(opGram) : Number(b.actual_gram || b.planned_gram || 0);
    const nQ = opQty ? parseInt(opQty) : Number(b.actual_qty || b.planned_qty || 0);
    await supabase.from("batches").update({ current_step: next, actual_gram: nG, actual_qty: nQ, status: done ? "Tugatildi" : "Jarayonda" }).eq("id", b.id);
    setOpGram(""); setOpQty(""); load();
    setSel({ ...b, current_step: next, actual_gram: nG, actual_qty: nQ, status: done ? "Tugatildi" : "Jarayonda" });
  };

  const toggleMac = async (m: any) => {
    const next = m.status === "bo'sh" ? "band" : "bo'sh";
    await supabase.from("machines").update({ status: next }).eq("id", m.id);
    load();
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Ishlab chiqarish (Partiyalar & Flow)</h1>
        <div className="flex gap-1.5 bg-slate-100 p-1.5 rounded-xl border">
          <button onClick={() => setTab("list")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === "list" ? "bg-purple-600 text-white" : "text-slate-600"}`}>⚙️ Partiyalar ({batches.length})</button>
          <button onClick={() => setTab("machines")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === "machines" ? "bg-purple-600 text-white" : "text-slate-600"}`}>🔬 Apparatlar ({machines.length})</button>
          <button onClick={() => setTab("tv")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === "tv" ? "bg-purple-600 text-white" : "text-slate-600"}`}>📺 TV Monitor</button>
        </div>
      </div>

      {tab === "list" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={createBatch} className="bg-white p-6 rounded-2xl shadow-sm border space-y-3 text-sm h-fit">
            <h2 className="text-lg font-bold border-b pb-2">Yangi partiya ochish</h2>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-semibold">Partiya No</label><input value={bNo} onChange={e => setBNo(e.target.value)} placeholder="B-0011" className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
              <div><label className="text-xs font-semibold">Proba</label><input type="number" value={proba} onChange={e => setProba(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
            </div>
            <div><label className="text-xs font-semibold">Mahsulot / Komplekt</label><input value={prod} onChange={e => setProd(e.target.value)} placeholder="Komplekt" className="w-full border rounded-xl p-2 mt-1" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-semibold">Vazn (gr)</label><input type="number" value={pGram} onChange={e => setPGram(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
              <div><label className="text-xs font-semibold">Soni (dona)</label><input type="number" value={pQty} onChange={e => setPQty(e.target.value)} className="w-full border rounded-xl p-2 mt-1 font-bold" /></div>
            </div>
            <div><label className="text-xs font-semibold">Mas'ul usta</label><input value={master} onChange={e => setMaster(e.target.value)} className="w-full border rounded-xl p-2 mt-1" /></div>
            <button type="submit" className="w-full bg-purple-600 text-white font-bold py-3 rounded-xl">Partiyani boshlash</button>
          </form>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border">
              <h2 className="font-bold mb-3">Partiyalar ro'yxati (Boshqarish uchun ustiga bosing)</h2>
              <table className="w-full text-left text-sm">
                <thead><tr className="text-xs text-slate-500 bg-slate-50 border-b"><th className="p-2.5">No</th><th className="p-2.5">Mahsulot</th><th className="p-2.5">Usta</th><th className="p-2.5">Bosqich</th><th className="p-2.5 text-right">Massa</th><th className="p-2.5 text-center">Holat</th></tr></thead>
                <tbody>
                  {batches.map((b, i) => {
                    const d = isDone(b.status);
                    return (
                      <tr key={i} onClick={() => setSel(b)} className="border-b cursor-pointer hover:bg-slate-50">
                        <td className="p-2.5 font-bold">{b.batch_no || b.number || `B-00${i + 1}`}</td>
                        <td className="p-2.5">{b.product_name || b.product || "Komplekt"}</td>
                        <td className="p-2.5 text-blue-600">{b.master_name || b.master || "Valijon"}</td>
                        <td className="p-2.5"><span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold">{d ? "24. Tayyor ombor" : (b.current_step || "7. Quyish")}</span></td>
                        <td className="p-2.5 text-right font-bold">{Number(b.actual_gram || b.planned_gram || 0)} gr</td>
                        <td className="p-2.5 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${d ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{d ? "Tugatildi" : "Jarayonda"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {sel && (
              <div className="bg-white p-6 rounded-2xl border-2 border-purple-500 space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="font-bold text-lg">{sel.batch_no || sel.number} — 25 bosqichli Pasport</h3>
                  <button onClick={() => setSel(null)} className="text-xs text-slate-500">✕ Yopish</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {OPS.map((st, i) => {
                    const cIdx = OPS.indexOf(sel.current_step || "7. Quyish");
                    const d = i < cIdx || isDone(sel.status);
                    const cur = i === cIdx && !isDone(sel.status);
                    return <span key={i} className={`px-2 py-1 rounded text-[11px] font-semibold border ${d ? "bg-emerald-50 text-emerald-700" : cur ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-400"}`}>{st}</span>;
                  })}
                </div>
                <div className="flex gap-3 items-end bg-slate-50 p-3 rounded-xl border text-xs">
                  <div><label className="block mb-1 font-semibold">Chiqish vazni (gr)</label><input type="number" value={opGram} onChange={e => setOpGram(e.target.value)} placeholder={String(sel.actual_gram || 500)} className="border rounded p-1.5 bg-white" /></div>
                  <div><label className="block mb-1 font-semibold">Tayyor dona</label><input type="number" value={opQty} onChange={e => setOpQty(e.target.value)} placeholder={String(sel.actual_qty || 10)} className="border rounded p-1.5 bg-white" /></div>
                  <button onClick={() => nextStep(sel)} className="bg-emerald-600 text-white font-bold px-4 py-2 rounded-xl">✓ Keyingi bosqichga o'tkazish →</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "machines" && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {machines.map(m => (
            <div key={m.id} className="bg-white p-4 rounded-2xl border space-y-2">
              <div className="flex justify-between text-xs font-bold"><span className="text-slate-400">{m.department}</span><span className={m.status === "bo'sh" ? "text-emerald-600" : "text-blue-600"}>{m.status.toUpperCase()}</span></div>
              <div className="font-bold">{m.name}</div>
              <button onClick={() => toggleMac(m)} className="w-full bg-slate-100 text-xs font-semibold py-1.5 rounded-lg">Holatni almashtirish</button>
            </div>
          ))}
        </div>
      )}

      {tab === "tv" && (
        <div className="bg-slate-900 p-6 rounded-2xl text-white">
          <h2 className="text-lg font-black mb-4">📺 PRODUCTION BOARD</h2>
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-slate-700 text-slate-400"><th className="p-2">PARTIYA</th><th className="p-2">MAHSULOT</th><th className="p-2">BOSQICH</th><th className="p-2 text-right">MASSA</th></tr></thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={i} className="border-b border-slate-800 font-bold">
                  <td className="p-2">{b.batch_no || b.number || `B-00${i + 1}`}</td>
                  <td className="p-2">{b.product_name || b.product || "Komplekt"}</td>
                  <td className="p-2 text-blue-400">{isDone(b.status) ? "24. Tayyor ombor" : (b.current_step || "7. Quyish")}</td>
                  <td className="p-2 text-right text-amber-400">{b.actual_gram || b.planned_gram || 0} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}