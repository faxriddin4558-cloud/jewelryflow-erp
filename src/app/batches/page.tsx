"use client";
import { useState, useEffect } from "react";
import { supabase, GoldEngine, RBAC, logErpAudit } from "@/lib/erp-engine";

export default function BatchesPage() {
  const [tab, setTab] = useState<"wip" | "queue" | "machines" | "tv">("wip");
  const [batches, setBatches] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [wipRows, setWipRows] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const [bNo, setBNo] = useState("");
  const [prod, setProd] = useState("");
  const [proba, setProba] = useState("585");
  const [pQty, setPQty] = useState("10");
  const [pGram, setPGram] = useState("150");
  const [prio, setPrio] = useState("Normal");
  const [dl, setDl] = useState("");

  const [fromSt, setFromSt] = useState<number>(8);
  const [mQty, setMQty] = useState("4");
  const [mGram, setMGram] = useState("60");
  const [spG, setSpG] = useState("0");
  const [scG, setScG] = useState("0");
  const [lsG, setLsG] = useState("0");
  const [rwQ, setRwQ] = useState("0");
  const [worker, setWorker] = useState("Valijon");
  const [splitQ, setSplitQ] = useState("3");

  const load = async () => {
    const [b, s, w, m] = await Promise.all([
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("production_stages").select("*").order("stage_order"),
      supabase.from("batch_stage_wip").select("*").order("stage_order"),
      supabase.from("machines").select("*").order("name")
    ]);
    if (b.data) setBatches(b.data);
    if (s.data) setStages(s.data);
    if (w.data) setWipRows(w.data);
    if (m.data) setMachines(m.data);
  };
  useEffect(() => { load(); }, []);

  const isDone = (s: string) => s === "Tugatildi" || (s || "").toLowerCase() === "completed";

  const createBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !RBAC.can("create_batch")) return alert("Ruxsat yo'q yoki jarayon band!");
    const qN = parseInt(pQty) || 0, gN = parseFloat(pGram) || 0, prN = parseInt(proba) || 585;
    if (!bNo || !prod || qN <= 0 || gN <= 0) return alert("Ma'lumotlarni to'g'ri kiriting!");
    setBusy(true);
    const { data: nb } = await supabase.from("batches").insert([{
      batch_no: bNo, product_name: prod, master_name: worker, status: "Jarayonda",
      proba: prN, planned_qty: qN, planned_gram: gN, actual_qty: qN, actual_gram: gN,
      issued_gold_gram: gN, wip_gram: gN, current_step: "8. Quyish (Casting)", priority: prio, deadline: dl || null
    }]).select().single();
    if (nb) {
      await supabase.from("batch_stage_wip").insert([{
        batch_id: nb.id, batch_no: bNo, stage_order: 8, stage_name: "8. Quyish (Casting)",
        department: "Quyish", available_qty: qN, input_weight: gN, queue_status: "NOW", assigned_worker: worker
      }]);
      await supabase.from("gold_transactions").insert([{
        transaction_type: "chiqim", from_location: "SAFE", to_location: "CASTING_WIP",
        material_name: `Partiyaga oltin (${bNo})`, gross_weight: gN, proba: prN,
        pure_gold: GoldEngine.toFineGold(gN, prN), batch_no: bNo, description: `SAFE -> CASTING (${qN} komplekt)`
      }]);
      await logErpAudit({ table: "batches", recordId: bNo, action: "CREATE_BATCH", newData: nb });
    }
    setBNo(""); setProd(""); setBusy(false); load();
  };

  // 6-BAND: QUANTITY-BASED PARTIAL WIP (Masalan: 10 tadan 4 tasini keyingi sexga uzatish)
  const movePartialWip = async (b: any) => {
    if (busy) return;
    const qMove = parseInt(mQty) || 0, gMove = parseFloat(mGram) || 0, qRew = parseInt(rwQ) || 0;
    const gSprue = parseFloat(spG) || 0, gScrap = parseFloat(scG) || 0, gLoss = parseFloat(lsG) || 0;
    if (qMove <= 0 && qRew <= 0) return alert("Miqdor 0 bo'lishi mumkin emas!");

    const bCode = b.batch_no || b.number;
    const curWip = wipRows.find(w => w.batch_no === bCode && w.stage_order === fromSt);
    const avail = curWip ? Number(curWip.available_qty) : Number(b.planned_qty || 10);
    if (qMove + qRew > avail) return alert(`XATO: Bu bosqichda faqat ${avail} dona mavjud!`);

    setBusy(true);
    const nextSt = stages.find(s => s.stage_order === fromSt + 1) || { stage_order: 25, name: "25. Tayyor mahsulot ombori", department: "Ombor" };
    const rem = avail - qMove - qRew;

    if (curWip) {
      await supabase.from("batch_stage_wip").update({
        available_qty: rem, completed_qty: Number(curWip.completed_qty || 0) + qMove,
        rework_qty: Number(curWip.rework_qty || 0) + qRew, output_weight: Number(curWip.output_weight || 0) + gMove,
        loss_weight: Number(curWip.loss_weight || 0) + gLoss, queue_status: rem === 0 ? "DONE" : "NOW"
      }).eq("id", curWip.id);
    } else {
      await supabase.from("batch_stage_wip").insert([{
        batch_id: b.id, batch_no: bCode, stage_order: fromSt, stage_name: stages.find(s => s.stage_order === fromSt)?.name || "Quyish",
        department: "Quyish", available_qty: rem, completed_qty: qMove, rework_qty: qRew, input_weight: b.planned_gram || 150, output_weight: gMove
      }]);
    }

    if (qMove > 0) {
      const nxtW = wipRows.find(w => w.batch_no === bCode && w.stage_order === nextSt.stage_order);
      if (nxtW) {
        await supabase.from("batch_stage_wip").update({
          available_qty: Number(nxtW.available_qty) + qMove, input_weight: Number(nxtW.input_weight || 0) + gMove, queue_status: "NOW"
        }).eq("id", nxtW.id);
      } else {
        await supabase.from("batch_stage_wip").insert([{
          batch_id: b.id, batch_no: bCode, stage_order: nextSt.stage_order, stage_name: nextSt.name,
          department: nextSt.department, available_qty: qMove, input_weight: gMove, queue_status: "NOW", assigned_worker: worker
        }]);
      }
    }

    const nSprue = Number(b.sprue_gram || 0) + gSprue, nScrap = Number(b.scrap_gram || 0) + gScrap, nLoss = Number(b.loss_gram || 0) + gLoss;
    const isFinal = nextSt.stage_order >= 25;
    const nFinQ = isFinal ? Number(b.finished_qty || 0) + qMove : Number(b.finished_qty || 0);
    const nGoodG = isFinal ? Number(b.good_output_gram || 0) + gMove : Number(b.good_output_gram || 0);
    const inG = Number(b.issued_gold_gram || b.planned_gram || 150);
    const nWipG = Math.max(0, Number((inG - nGoodG - nSprue - nScrap - nLoss).toFixed(2)));
    const doneAll = nFinQ >= Number(b.planned_qty || 10);

    await supabase.from("batches").update({
      current_step: nextSt.name, sprue_gram: nSprue, scrap_gram: nScrap, loss_gram: nLoss,
      good_output_gram: nGoodG, wip_gram: nWipG, finished_qty: nFinQ, status: doneAll ? "Tugatildi" : "Jarayonda"
    }).eq("id", b.id);

    await logErpAudit({ table: "batch_stage_wip", recordId: bCode, action: "PARTIAL_MOVE", newData: { fromSt, to: nextSt.name, qMove, gMove } });
    setBusy(false);
    alert(`${qMove} komplekt (${gMove}g) "${nextSt.name}" ga o'tkazildi! Joriy bo'limda ${rem} komplekt qoldi.`);
    load();
  };

  const splitBatch = async (b: any) => {
    const sQ = parseInt(splitQ) || 0, totQ = Number(b.planned_qty || 10);
    if (sQ <= 0 || sQ >= totQ) return alert("Bo'linadigan son noto'g'ri!");
    const sG = Number((Number(b.planned_gram || 150) * (sQ / totQ)).toFixed(2));
    const remG = Number((Number(b.planned_gram || 150) - sG).toFixed(2));
    const child = `${b.batch_no || b.number}-S1`;
    await supabase.from("batches").update({ planned_qty: totQ - sQ, planned_gram: remG, issued_gold_gram: remG }).eq("id", b.id);
    await supabase.from("batches").insert([{
      batch_no: child, parent_batch_no: b.batch_no || b.number, product_name: b.product_name, master_name: b.master_name,
      proba: b.proba || 585, planned_qty: sQ, planned_gram: sG, issued_gold_gram: sG, wip_gram: sG, current_step: b.current_step, status: "Jarayonda"
    }]);
    alert(`Partiya bo'lindi: ${child} (${sQ} dona / ${sG}g)`);
    load();
  };

  const deptQueues = ["Quyish", "Zaklirovka", "Sanding", "Ponza", "Polirovka", "Tosh qo'yish", "Lazer", "Moyka", "QC"].map(d => {
    const list = wipRows.filter(w => w.department === d && w.available_qty > 0);
    const pcs = list.reduce((s, w) => s + Number(w.available_qty || 0), 0);
    const cap = d === "Lazer" || d === "Tosh qo'yish" ? 200 : 300;
    return { dept: d, pcs, cap, backlog: Math.max(0, pcs - cap), list };
  });

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Partiya Engine, Quantity-WIP (4/10 → 3/4) & Mass Balance</h1>
        <div className="flex gap-1.5 bg-slate-100 p-1.5 rounded-xl border">
          <button onClick={() => setTab("wip")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === "wip" ? "bg-purple-600 text-white" : "text-slate-600"}`}>⚙️ Partiyalar & WIP ({batches.length})</button>
          <button onClick={() => setTab("queue")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === "queue" ? "bg-purple-600 text-white" : "text-slate-600"}`}>🚦 Queue & Bottleneck</button>
          <button onClick={() => setTab("machines")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === "machines" ? "bg-purple-600 text-white" : "text-slate-600"}`}>🔬 Apparatlar ({machines.length})</button>
          <button onClick={() => setTab("tv")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === "tv" ? "bg-purple-600 text-white" : "text-slate-600"}`}>📺 TV Monitor</button>
        </div>
      </div>

      {tab === "wip" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={createBatch} className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit">
            <h2 className="font-bold border-b pb-2">➕ Yangi Partiya (SAFE → CASTING)</h2>
            <div className="grid grid-cols-2 gap-2">
              <input value={bNo} onChange={e => setBNo(e.target.value)} placeholder="Batch ID (B-0012)" className="border rounded-xl p-2 font-bold" />
              <input type="number" value={proba} onChange={e => setProba(e.target.value)} placeholder="Proba" className="border rounded-xl p-2 font-bold" />
            </div>
            <input value={prod} onChange={e => setProd(e.target.value)} placeholder="Model / Komplekt nomi" className="w-full border rounded-xl p-2" />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-slate-500">Reja Soni (komplekt)</label><input type="number" value={pQty} onChange={e => setPQty(e.target.value)} className="w-full border rounded-xl p-2 font-bold" /></div>
              <div><label className="text-xs text-slate-500">Berilgan Oltin (gr)</label><input type="number" value={pGram} onChange={e => setPGram(e.target.value)} className="w-full border rounded-xl p-2 font-bold text-amber-700" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={prio} onChange={e => setPrio(e.target.value)} className="border rounded-xl p-2 bg-white font-bold"><option>Normal</option><option>VIP</option><option>URGENT</option></select>
              <input type="date" value={dl} onChange={e => setDl(e.target.value)} className="border rounded-xl p-2" />
            </div>
            <button type="submit" disabled={busy} className="w-full bg-purple-600 text-white font-bold py-2.5 rounded-xl">Partiya ochish</button>
          </form>

          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white p-5 rounded-2xl border overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="text-xs text-slate-500 bg-slate-50 border-b"><th className="p-2">ID</th><th className="p-2">Model</th><th className="p-2">Tayyor/Reja</th><th className="p-2">Input / WIP</th><th className="p-2">Mass Balance</th><th className="p-2">Holat</th></tr></thead>
                <tbody>
                  {batches.map((b, i) => {
                    const d = isDone(b.status);
                    const inG = Number(b.issued_gold_gram || b.planned_gram || 500);
                    const goodG = Number(b.good_output_gram || (d ? b.actual_gram || 485 : 0));
                    const lsG = Number(b.loss_gram || (d ? 15 : 0));
                    const wipG = d ? 0 : Number(b.wip_gram ?? (inG - goodG - lsG));
                    const mb = GoldEngine.verifyMassBalance({ inputGold: inG, goodProduct: goodG, sprue: b.sprue_gram || 0, scrap: b.scrap_gram || 0, rework: 0, loss: lsG, remainingWip: wipG });
                    return (
                      <tr key={i} onClick={() => setSel(b)} className={`border-b cursor-pointer ${sel?.id === b.id ? "bg-purple-50" : "hover:bg-slate-50"}`}>
                        <td className="p-2 font-bold">{b.batch_no || b.number}</td>
                        <td className="p-2">{b.product_name || b.product}</td>
                        <td className="p-2 font-bold text-blue-700">{d ? (b.planned_qty || 10) : (b.finished_qty || 0)}/{b.planned_qty || 10}</td>
                        <td className="p-2">{inG}g / <b>{wipG}g</b></td>
                        <td className="p-2 text-xs font-bold"><span className={mb.isBalanced ? "text-emerald-600" : "text-red-600"}>{mb.statusText}</span></td>
                        <td className="p-2"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${d ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{d ? "Tugatildi" : "Jarayonda"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {sel && (
              <div className="bg-white p-5 rounded-2xl border-2 border-purple-600 space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="font-bold text-lg">{sel.batch_no || sel.number} — Bo'lib-bo'lib o'tkazish (Partial Quantity WIP)</h3>
                  <div className="flex gap-2">
                    <input type="number" value={splitQ} onChange={e => setSplitQ(e.target.value)} className="w-14 border rounded p-1 text-xs font-bold" />
                    <button onClick={() => splitBatch(sel)} className="bg-slate-800 text-white text-xs px-2.5 py-1 rounded">✂️ Split</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {wipRows.filter(w => w.batch_no === (sel.batch_no || sel.number)).map((w, idx) => (
                    <div key={idx} onClick={() => setFromSt(w.stage_order)} className={`p-2.5 rounded-xl border text-xs cursor-pointer ${fromSt === w.stage_order ? "border-blue-600 bg-blue-50" : "bg-slate-50"}`}>
                      <b>{w.stage_name}</b>
                      <div className="text-blue-700 font-black mt-1">Mavjud: {w.available_qty} | Tayyor: {w.completed_qty}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl border text-xs">
                  <div><label className="font-bold">Qaysi bosqichdan?</label><select value={fromSt} onChange={e => setFromSt(Number(e.target.value))} className="w-full border rounded p-1.5 bg-white mt-1">{stages.map(s => <option key={s.stage_order} value={s.stage_order}>{s.name}</option>)}</select></div>
                  <div><label className="font-bold text-emerald-700">Tayyor (Qty dona)</label><input type="number" value={mQty} onChange={e => setMQty(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1 font-bold" /></div>
                  <div><label className="font-bold text-emerald-700">Vazni (gr)</label><input type="number" value={mGram} onChange={e => setMGram(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1 font-bold" /></div>
                  <div><label className="font-bold text-amber-700">Sprue / Qoldiq (gr)</label><input type="number" value={spG} onChange={e => setSpG(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1" /></div>
                  <div><label className="font-bold text-red-600">Scrap / Brak (gr)</label><input type="number" value={scG} onChange={e => setScG(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1" /></div>
                  <div><label className="font-bold text-red-700">Pateriya / Loss (gr)</label><input type="number" value={lsG} onChange={e => setLsG(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1" /></div>
                  <div><label className="font-bold text-amber-700">QC Rework (dona)</label><input type="number" value={rwQ} onChange={e => setRwQ(e.target.value)} className="w-full border rounded p-1.5 bg-white mt-1" /></div>
                  <div className="flex items-end"><button onClick={() => movePartialWip(sel)} className="w-full bg-emerald-600 text-white font-bold py-2 rounded-lg">✓ {mQty} donani o'tkazish →</button></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "queue" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {deptQueues.map((q, i) => (
            <div key={i} className="bg-white p-4 rounded-2xl border space-y-2">
              <div className="flex justify-between items-center border-b pb-2">
                <div><b>{q.dept}</b><div className="text-[11px] text-slate-400">Capacity: {q.cap} pcs/day</div></div>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${q.backlog > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>Queue: {q.pcs} pcs</span>
              </div>
              {q.list.map((it: any, j: number) => (
                <div key={j} className="text-xs bg-slate-50 p-2 rounded border flex justify-between"><b>{it.batch_no} ({it.queue_status})</b><b>{it.available_qty} dona ({it.input_weight}g)</b></div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "machines" && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {machines.map(m => (
            <div key={m.id} className="bg-white p-4 rounded-2xl border space-y-2">
              <div className="flex justify-between text-xs font-bold"><span className="text-slate-400">{m.department}</span><span className="text-blue-600">{m.status.toUpperCase()}</span></div>
              <div className="font-bold">{m.name}</div>
              <div className="text-xs text-slate-500">Capacity: {m.daily_capacity || 250} pcs/day</div>
            </div>
          ))}
        </div>
      )}

      {tab === "tv" && (
        <div className="bg-slate-950 p-6 rounded-2xl text-white">
          <h2 className="text-xl font-black mb-4">📺 SHOPFLOOR LIVE TV MONITOR</h2>
          <table className="w-full text-left">
            <thead><tr className="border-b border-slate-800 text-slate-400 text-xs"><th className="p-2">BATCH</th><th className="p-2">PRIORITY</th><th className="p-2">MODEL</th><th className="p-2">STAGE</th><th className="p-2">QTY</th><th className="p-2 text-right">MASSA</th></tr></thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={i} className="border-b border-slate-900 font-bold text-lg">
                  <td className="p-2 text-amber-400">{b.batch_no || b.number}</td>
                  <td className="p-2 text-xs">{b.priority || "NORMAL"}</td>
                  <td className="p-2">{b.product_name || b.product}</td>
                  <td className="p-2 text-blue-400">{isDone(b.status) ? "25. Tayyor ombor" : (b.current_step || "8. Quyish")}</td>
                  <td className="p-2 text-emerald-400">{b.finished_qty || 0}/{b.planned_qty || 10}</td>
                  <td className="p-2 text-right">{b.actual_gram || b.planned_gram || 500} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}