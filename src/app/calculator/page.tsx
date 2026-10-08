"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function CalculatorPage() {
  // 1. Proba va Ligatura hisoblagichi state'lari
  const [goldWeight, setGoldWeight] = useState("50");
  const [currentProba, setCurrentProba] = useState("999");
  const [targetProba, setTargetProba] = useState("585");
  const [newAlloyRatio, setNewAlloyRatio] = useState("70"); // 70% yangi / 30% eski (PRD 2-band)

  // 2. Affinaj (Raffinatsiya) state'lari
  const [scrapWeight, setScrapWeight] = useState("120");
  const [scrapProba, setScrapProba] = useState("585");
  const [sourceMaterial, setSourceMaterial] = useState("Lom / Qirindi / Eski tilla");
  const [reagentsUsed, setReagentsUsed] = useState("Mis (Kvartovka) + Azot kislotasi (HNO3)");
  const [actualOutputWeight, setActualOutputWeight] = useState("");
  const [outputProba, setOutputProba] = useState("999");
  const [responsiblePerson, setResponsiblePerson] = useState("Valijon");
  const [isSaving, setIsSaving] = useState(false);
  const [affinajHistory, setAffinajHistory] = useState<any[]>([]);

  // --- MATEMATIK FORMULALAR (PRD 3 & 35-bandlar) ---
  const wNum = parseFloat(goldWeight) || 0;
  const cProba = parseFloat(currentProba) || 0;
  const tProba = parseFloat(targetProba) || 585;
  const ratioNew = parseFloat(newAlloyRatio) || 70;

  // Sof oltin = Massa * Proba / 1000
  const pureGoldContent = (wNum * cProba) / 1000;

  // Agar joriy proba > kutilayotgan proba bo'lsa (Masalan: 999 -> 585): Ligatura qo'shiladi
  // Yakuniy massa = (Massa * Joriy_Proba) / Kutilayotgan_Proba
  const isLoweringProba = cProba >= tProba && tProba > 0;
  const finalAlloyWeight = tProba > 0 ? (wNum * cProba) / tProba : 0;
  const requiredLigatura = Math.max(0, finalAlloyWeight - wNum);

  // Agar joriy proba < kutilayotgan proba bo'lsa (Masalan: 500 -> 585): 999 oltin qo'shiladi
  const requiredPureGoldToAdd =
    !isLoweringProba && 999 > tProba
      ? (wNum * (tProba - cProba)) / (999 - tProba)
      : 0;
  const finalRaisedWeight = wNum + requiredPureGoldToAdd;

  // --- AFFINAJ HISOB-KITOBI ---
  const sWeight = parseFloat(scrapWeight) || 0;
  const sProba = parseFloat(scrapProba) || 0;
  const expectedPureGold = (sWeight * sProba) / 1000; // Nazariy chiqishi kerak bo'lgan sof oltin
  const outWeight = actualOutputWeight !== "" ? parseFloat(actualOutputWeight) : expectedPureGold;
  const outProba = parseFloat(outputProba) || 999;
  const actualPureGold = (outWeight * outProba) / 1000;
  const refiningLoss = Math.max(0, expectedPureGold - actualPureGold); // Yo'qotish (Pateriya)

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

  // Affinaj natijasini bazaga (va omborga) saqlash
  const handleSaveAffinaj = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sWeight <= 0) return alert("Boshlang'ich lom massasini kiriting!");
    setIsSaving(true);

    // 1. Affinaj jurnaliga yozish
    await supabase.from("gold_transactions").insert([
      {
        transaction_type: "affinaj",
        material_name: `${sourceMaterial} -> Toza Oltin (${outProba})`,
        gross_weight: outWeight,
        proba: outProba,
        pure_gold: actualPureGold,
        description: `Boshlang'ich: ${sWeight}g (${sProba}) | Reagent: ${reagentsUsed} | Yo'qotish: ${refiningLoss.toFixed(2)}g | Mas'ul: ${responsiblePerson}`
      }
    ]);

    // 2. Tozalangan oltinni Omborga (kirim sifatida) avtomatik qo'shish
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
      alert(`Affinaj muvaffaqiyatli saqlandi! Omborga ${outWeight.toFixed(2)} gr (${outProba} proba) toza oltin kirim qilindi.`);
      setActualOutputWeight("");
      fetchAffinajHistory();
    }
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Proba, Ligatura va Affinaj Markazi</h1>
        <p className="text-xs text-slate-500 mt-1">
          Oltin qotishmalarini aniq formula bo'yicha hisoblash va kislotali tozalash (affinaj) amaliyotlarini ro'yxatga olish
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CHAP KARTA: PROBA VA LIGATURA HISOBLAGICHI */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5 h-fit">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              ⚖️ Proba tushirish / ko'tarish (Qotishma & Ligatura)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Mavjud massa va probadan kerakli probani (masalan 999 → 585) hosil qilish formulasi
            </p>
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Mavjud tilla massasi (gr)</label>
              <input
                type="number"
                step="0.01"
                value={goldWeight}
                onChange={(e) => setGoldWeight(e.target.value)}
                placeholder="Masalan: 50"
                className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold focus:border-blue-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Joriy proba</label>
                <input
                  type="number"
                  value={currentProba}
                  onChange={(e) => setCurrentProba(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Kutilayotgan (Kerakli) proba</label>
                <input
                  type="number"
                  value={targetProba}
                  onChange={(e) => setTargetProba(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 font-semibold focus:border-blue-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Qotishma tarkibi: Yangi oltin ulushi ({ratioNew}% yangi / {100 - ratioNew}% eski lom)
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={newAlloyRatio}
                onChange={(e) => setNewAlloyRatio(e.target.value)}
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>
          </div>

          {/* HISOBLASH NATIJASI BLOKI */}
          <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600">Tarkibidagi sof oltin (999.9):</span>
              <span className="font-bold text-amber-600 text-base">{pureGoldContent.toFixed(2)} gr</span>
            </div>

            {isLoweringProba ? (
              <>
                <div className="flex justify-between items-center text-sm border-t border-slate-200 pt-2.5">
                  <span className="text-slate-700 font-medium">Qo'shiladigan Ligatura (Mis/Kumush):</span>
                  <span className="font-extrabold text-blue-600 text-lg">+{requiredLigatura.toFixed(2)} gr</span>
                </div>
                <div className="flex justify-between items-center text-sm border-t border-slate-200 pt-2.5">
                  <span className="text-slate-700 font-medium">Hosil bo'ladigan jami ({tProba} proba):</span>
                  <span className="font-extrabold text-emerald-600 text-lg">{finalAlloyWeight.toFixed(2)} gr</span>
                </div>
                <div className="text-[11px] text-slate-500 bg-white p-2.5 rounded-lg border border-slate-200 mt-2">
                  <b>Tarkib tavsiyasi ({ratioNew}/{100 - ratioNew}):</b>{" "}
                  {((finalAlloyWeight * ratioNew) / 100).toFixed(2)} gr yangi qotishma +{" "}
                  {((finalAlloyWeight * (100 - ratioNew)) / 100).toFixed(2)} gr eski aylanma oltin.
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center text-sm border-t border-slate-200 pt-2.5">
                  <span className="text-slate-700 font-medium">Probani {tProba} ga ko'tarish uchun kerakli 999 oltin:</span>
                  <span className="font-extrabold text-blue-600 text-lg">+{requiredPureGoldToAdd.toFixed(2)} gr</span>
                </div>
                <div className="flex justify-between items-center text-sm border-t border-slate-200 pt-2.5">
                  <span className="text-slate-700 font-medium">Yakuniy hosil bo'ladigan massa ({tProba} proba):</span>
                  <span className="font-extrabold text-emerald-600 text-lg">{finalRaisedWeight.toFixed(2)} gr</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* O'NG KARTA: AFFINAJ (TILLANI TOZALASH) MODULI */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              🧪 Tillani tozalash (Affinaj / Raffinatsiya)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Eski tilla yoki