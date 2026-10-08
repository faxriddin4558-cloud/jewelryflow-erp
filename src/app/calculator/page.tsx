"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function CalculatorPage() {
  const [goldWeight, setGoldWeight] = useState("100");
  const [currentProba, setCurrentProba] = useState("999");
  const [targetProba, setTargetProba] = useState("585");
  const [newAlloyRatio, setNewAlloyRatio] = useState("70");

  const [scrapWeight, setScrapWeight] = useState("400");
  const [scrapProba, setScrapProba] = useState("585");
  const [sourceMaterial, setSourceMaterial] = useState("Lom / Qirindi / Eski tilla");
  const [reagentsUsed, setReagentsUsed] = useState("Mis + Azot kislotasi (HNO3)");
  const [actualOutputWeight, setActualOutputWeight] = useState("");
  const [outputProba, setOutputProba] = useState("999");
  const [responsiblePerson, setResponsiblePerson] = useState("Valijon");
  const [isSaving, setIsSaving] = useState(false);
  const [affinajHistory, setAffinajHistory] = useState<any[]>([]);

  const wNum = parseFloat(goldWeight) || 0;
  const cProba = parseFloat(currentProba) || 0;
  const tProba = parseFloat(targetProba) || 585;
  const ratioNew = parseFloat(newAlloyRatio) || 70;

  const pureGoldContent = (wNum * cProba) / 1000;
  const isLoweringProba = cProba >= tProba && tProba > 0;
  const finalAlloyWeight = tProba > 0 ? (wNum * cProba) / tProba : 0;
  const requiredLigatura = Math.max(0, finalAlloyWeight - wNum);

  const requiredPureGoldToAdd =
    !isLoweringProba && 999 > tProba
      ? (wNum * (tProba - cProba)) / (999 - tProba)
      : 0;
  const finalRaisedWeight = wNum + requiredPureGoldToAdd;

  const sWeight = parseFloat(scrapWeight) || 0;
  const sProba = parseFloat(scrapProba) || 0;
  const expectedPureGold = (sWeight * sProba) / 1000;
  const outWeight = actualOutputWeight !== "" ? parseFloat(actualOutputWeight) : expectedPureGold;
  const outProba = parseFloat(outputProba) || 999;
  const actualPureGold = (outWeight * outProba) / 1000;
  const refiningLoss = Math.max(0, expectedPureGold - actualPureGold);

  const fetchAffinajHistory = async () => {
    const { data } = await supabase
      .from("gold_transactions")
      .select("*")
      .eq("transaction_type", "affinaj")
      .order("created_at", { ascending: false });
    if (data) setAffinajHistory(data);
  };

  useEffect(() => {
    fetchAffinajHistory();
  }, []);

  const handleSaveAffinaj = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sWeight <= 0) return alert("Boshlang'ich lom massasini kiriting!");
    setIsSaving(true);

    await supabase.from("gold_transactions").insert([
      {
        transaction_type: "affinaj",
        material_name: `${sourceMaterial} -> Toza Oltin (${outProba})`,
        gross_weight: outWeight,
        proba: outProba,
        pure_gold: actualPureGold,
        description: `Kirdi: ${sWeight}g (${sProba}) | Reagent: ${reagentsUsed} | Yo'qotish: ${refiningLoss.toFixed(2)}g | Mas'ul: ${responsiblePerson}`
      }
    ]);

    const { error } = await supabase.from("gold_transactions").insert([
      {
        transaction_type: "kirim",
        material_name: "Toza oltin (Affinajdan)",
        gross_weight: outWeight,
        proba: outProba,
        pure_gold: actualPureGold,
        description: `Affinajdan kirim (${responsiblePerson})`
      }
    ]);

    setIsSaving(false);
    if (error) {
      alert("Xatolik: " + error.message);
    } else {
      alert(`Affinaj saqlandi! Omborga ${outWeight.toFixed(2)} gr (${outProba} proba) toza oltin kirim qilindi.`);
      setActualOutputWeight("");
      fetchAffinajHistory();
    }
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Proba, Ligatura va Affinaj Markazi</h1>
        <p className="text-xs text-slate-500 mt-1">
          Oltin qotishmalarini aniq formula bo'yicha hisoblash va kislotali tozalash (affinaj) amaliyotlarini omborga ulash
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5 h-fit">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-slate-800">⚖️ Proba tushirish / ko'tarish (Qotishma & Ligatura)</h2>
            <p className="text-xs text-slate-500 mt-1">999 → 585 ligatura qo'shish yoki past probani 999 bilan ko'tarish</p>
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Mavjud tilla massasi (gr)</label>
              <input type="number" step="0.01" value={goldWeight} onChange={(e) => setGoldWeight(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold outline-none" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Joriy proba</label>
                <input type="number" value={currentProba} onChange={(e) => setCurrentProba(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Kutilayotgan proba</label>
                <input type="number" value={targetProba} onChange={(e) => setTargetProba(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold outline-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Qotishma tarkibi: {ratioNew}% yangi qotishma / {100 - ratioNew}% eski oltin (PRD 2-band)
              </label>
              <input type="range" min="0" max="100" step="5" value={newAlloyRatio} onChange={(e) => setNewAlloyRatio(e.target.value)} className="w-full accent-blue-600 cursor-pointer" />
            </div>
          </div>

          <div className="bg-amber-50/70 p-5 rounded-xl border border-amber-200 space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-700">Tarkibidagi sof oltin (999.9):</span>
              <span className="font-bold text-amber-700 text-base">{pureGoldContent.toFixed(2)} gr</span>
            </div>

            {isLoweringProba ? (
              <>
                <div className="flex justify-between items-center text-sm border-t border-amber-200/80 pt-2.5">
                  <span className="text-slate-800 font-medium">Qo'shiladigan Ligatura (Mis/Kumush):</span>
                  <span className="font-extrabold text-amber-800 text-lg">+{requiredLigatura.toFixed(2)} gr</span>
                </div>
                <div className="flex justify-between items-center text-sm border-t border-amber-200/80 pt-2.5">
                  <span className="text-slate-800 font-medium">Jami tayyor qotishma ({tProba} proba):</span>
                  <span className="font-extrabold text-emerald-700 text-lg">{finalAlloyWeight.toFixed(2)} gr</span>
                </div>
                <div className="text-xs text-slate-600 bg-white p-2.5 rounded-lg border border-amber-200 mt-2">
                  <b>Tavsiya ({ratioNew}/{100 - ratioNew}):</b> {((finalAlloyWeight * ratioNew) / 100).toFixed(2)} gr yangi + {((finalAlloyWeight * (100 - ratioNew)) / 100).toFixed(2)} gr eski oltin.
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center text-sm border-t border-amber-200/80 pt-2.5">
                  <span className="text-slate-800 font-medium">Probani {tProba} ga ko'tarish uchun 999 oltin:</span>
                  <span className="font-extrabold text-blue-700 text-lg">+{requiredPureGoldToAdd.toFixed(2)} gr</span>
                </div>
                <div className="flex justify-between items-center text-sm border-t border-amber-200/80 pt-2.5">
                  <span className="text-slate-800 font-medium">Yakuniy massa ({tProba} proba):</span>
                  <span className="font-extrabold text-emerald-700 text-lg">{finalRaisedWeight.toFixed(2)} gr</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-slate-800">🧪 Tillani tozalash (Affinaj / Raffinatsiya)</h2>
            <p className="text-xs text-slate-500 mt-1">Azot kislotasi va mis bilan qaynatib olingan sof 999 tillani hisoblash va omborga kirim qilish</p>
          </div>

          <form onSubmit={handleSaveAffinaj} className="space-y-3.5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Lom / Qirindi massasi (gr)</label>
                <input type="number" step="0.01" value={scrapWeight} onChange={(e) => setScrapWeight(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Lomning taxminiy probasi</label>
                <input type="number" value={scrapProba} onChange={(e) => setScrapProba(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold