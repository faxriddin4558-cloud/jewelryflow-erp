"use client";
import { useState } from "react";
import { supabase, GoldEngine, RBAC, logErpAudit } from "@/lib/erp-engine";

export default function CalculatorPage() {
  const [inW, setInW] = useState("100");
  const [curP, setCurP] = useState("999");
  const [tarP, setTarP] = useState("585");
  const [ratio, setRatio] = useState(70);

  const [scrapW, setScrapW] = useState("400");
  const [estP, setEstP] = useState("585");
  const [outW, setOutW] = useState("233.50");
  const [outP, setOutP] = useState("999");
  const [master, setMaster] = useState("Valijon");
  const [busy, setBusy] = useState(false);

  const alloy = GoldEngine.calculateAlloy(parseFloat(inW) || 0, parseInt(curP) || 999, parseInt(tarP) || 585, ratio);

  const scNum = parseFloat(scrapW) || 0, ePNum = parseInt(estP) || 585, oWNum = parseFloat(outW) || 0, oPNum = parseInt(outP) || 999;
  const expectedFine = GoldEngine.toFineGold(scNum, ePNum);
  const actualFine = GoldEngine.toFineGold(oWNum, oPNum);
  const refLoss = Number(Math.max(0, expectedFine - actualFine).toFixed(2));
  const copperRemoved = Number(Math.max(0, scNum - oWNum - refLoss).toFixed(2));

  // 13-BAND: LIGATURA AMALIYOTINI OMBOR VA GOLD LEDGERGA YOZISH
  const executeAlloyTransaction = async () => {
    if (busy || !RBAC.can("edit_inventory")) return alert("Ruxsat yo'q!");
    setBusy(true);
    await supabase.from("gold_transactions").insert([
      {
        transaction_type: "chiqim", from_location: "SAFE", to_location: "ALLOY_MELTING",
        material_name: `Qotishma uchun oltin (${curP})`, gross_weight: parseFloat(inW) || 0,
        proba: parseInt(curP) || 999, pure_gold: alloy.fineGold, description: `${curP} -> ${tarP} ligatura tayyorlash`
      },
      {
        transaction_type: "kirim", from_location: "ALLOY_MELTING", to_location: "SAFE",
        material_name: `Tayyor qotishma oltin (${tarP})`, gross_weight: alloy.totalOutputWeight,
        proba: parseInt(tarP) || 585, pure_gold: alloy.fineGold, description: `Ligatura (+${alloy.requiredLigature}g mis/kumush qo'shildi)`
      }
    ]);
    await logErpAudit({ table: "gold_transactions", action: "ALLOY_TRANSACTION", newData: alloy });
    setBusy(false);
    alert(`Qotishma tranzaksiyasi bajarildi: ${inW}g (${curP}) + ${alloy.requiredLigature}g Ligatura = ${alloy.totalOutputWeight}g (${tarP} proba) SAFE omboriga kirim qilindi!`);
  };

  // 14-BAND: AFFINAJ TRANZAKSIYASI (SCRAP -> AFFINAJ -> 999 GOLD SAFE + LOSS)
  const executeAffinajTransaction = async () => {
    if (busy || !RBAC.can("edit_inventory")) return alert("Ruxsat yo'q!");
    setBusy(true);
    await supabase.from("gold_transactions").insert([
      {
        transaction_type: "kirim", from_location: "AFFINAJ", to_location: "SAFE",
        material_name: `Affinaj sof oltin (${oPNum})`, gross_weight: oWNum,
        proba: oPNum, pure_gold: actualFine, description: `Affinaj: ${scNum}g (${ePNum}) lomdan olindi. Mas'ul: ${master}`
      }
    ]);
    if (refLoss > 0) {
      await supabase.from("consumption").insert([{
        batch_no: "AFFINAJ", master_name: master, department: "Affinaj", proba: oPNum,
        given_weight: expectedFine, returned_weight: actualFine, sprue_gram: 0, loss_weight: refLoss
      }]);
    }
    const { data: ex } = await supabase.from("inventory_items").select("*").eq("proba", oPNum).eq("category", "Gold").limit(1).single();
    if (ex) {
      await supabase.from("inventory_items").update({ on_hand: Number(ex.on_hand || 0) + oWNum }).eq("id", ex.id);
    } else {
      await supabase.from("inventory_items").insert([{ material_code: "AU-999", name: `Affinaj sof oltin (${oPNum})`, category: "Gold", unit: "gr", proba: oPNum, on_hand: oWNum, reserved: 0 }]);
    }
    await logErpAudit({ table: "gold_transactions", action: "AFFINAJ_COMPLETE", newData: { scNum, oWNum, refLoss, master } });
    setBusy(false);
    alert(`Affinaj yakunlandi! ${oWNum} gr (${oPNum}) sof oltin SAFE omboriga kirim qilindi. Pateriya: ${refLoss} gr.`);
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Proba, Ligatura va Affinaj Markazi (Central GoldEngine)</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
          <h2 className="text-lg font-bold border-b pb-2">⚖️ Proba tushirish / ko'tarish (Qotishma & Ligatura)</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><label className="text-xs font-semibold text-slate-500">Kirish vazni (gr)</label><input type="number" value={inW} onChange={e => setInW(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
            <div><label className="text-xs font-semibold text-slate-500">Joriy proba</label><input type="number" value={curP} onChange={e => setCurP(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
            <div><label className="text-xs font-semibold text-slate-500">Maqsadli proba</label><input type="number" value={tarP} onChange={e => setTarP(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Nisbat: {ratio}% yangi / {100 - ratio}% eski oltin</label>
            <input type="range" min={0} max={100} value={ratio} onChange={e => setRatio(Number(e.target.value))} className="w-full mt-1" />
          </div>
          <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 space-y-2 text-sm">
            <div className="flex justify-between"><span>Sof oltin (999.9):</span><b className="text-amber-800">{alloy.fineGold.toFixed(2)} gr</b></div>
            <div className="flex justify-between"><span>Qo'shiladigan ligatura (Mis/Kumush):</span><b className="text-red-600">+{alloy.requiredLigature.toFixed(2)} gr</b></div>
            <div className="flex justify-between border-t pt-2"><span>Jami tayyor qotishma ({tarP}):</span><b className="text-emerald-700 text-base">{alloy.totalOutputWeight.toFixed(2)} gr</b></div>
            <div className="text-xs text-slate-500 bg-white p-2 rounded border">Tavsiya: {alloy.newGoldShare}g yangi + {alloy.oldGoldShare}g eski oltin</div>
          </div>
          <button onClick={executeAlloyTransaction} disabled={busy} className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl shadow">
            🔥 Qotishmani tasdiqlash va Gold Ledgerga yozish
          </button>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
          <h2 className="text-lg font-bold border-b pb-2">🧪 Tillani tozalash (Affinaj Transaction)</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><label className="text-xs font-semibold text-slate-500">Lom / Sprue / Qirindi (gr)</label><input type="number" value={scrapW} onChange={e => setScrapW(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
            <div><label className="text-xs font-semibold text-slate-500">Taxminiy probasi</label><input type="number" value={estP} onChange={e => setEstP(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><label className="text-xs font-semibold text-emerald-700">Chiqdi sof oltin (gr)</label><input type="number" step="0.01" value={outW} onChange={e => setOutW(e.target.value)} className="w-full border-2 border-emerald-500 rounded-xl p-2.5 mt-1 font-bold" /></div>
            <div><label className="text-xs font-semibold text-slate-500">Chiqish probasi</label><input type="number" value={outP} onChange={e => setOutP(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
            <div><label className="text-xs font-semibold text-slate-500">Mas'ul usta</label><input value={master} onChange={e => setMaster(e.target.value)} className="w-full border rounded-xl p-2.5 mt-1 font-bold" /></div>
          </div>
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 space-y-2 text-sm">
            <div className="flex justify-between"><span>Kutilgan sof tilla (999):</span><b className="text-blue-900">{expectedFine.toFixed(2)} gr</b></div>
            <div className="flex justify-between"><span>Haqiqiy olingan sof tilla:</span><b className="text-emerald-700">{actualFine.toFixed(2)} gr</b></div>
            <div className="flex justify-between"><span>Ajralgan mis/shlak:</span><b className="text-slate-600">{copperRemoved.toFixed(2)} gr</b></div>
            <div className="flex justify-between border-t pt-2"><span>Affinaj yo'qotishi (Pateriya):</span><b className="text-red-600">{refLoss.toFixed(2)} gr</b></div>
          </div>
          <button onClick={executeAffinajTransaction} disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow">
            🧪 Affinajni yakunlash va SAFE Omborga kirim qilish
          </button>
        </div>
      </div>
    </div>
  );
}
