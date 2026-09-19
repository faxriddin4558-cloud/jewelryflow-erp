"use client";

import { useState } from "react";

export default function ProbaCalculatorPage() {
  // 1. Proba tushirish (Ligatura qo'shish)
  const [pureWeight, setPureWeight] = useState<number | "">("");
  const [currentProba, setCurrentProba] = useState<number>(999);
  const [targetProba, setTargetProba] = useState<number>(585);

  // 2. Affinaj (Kislota bilan tozalash)
  const [scrapWeight, setScrapWeight] = useState<number | "">("");
  const [scrapProba, setScrapProba] = useState<number>(585);

  // Formulalar
  const ligaturaNeeded = pureWeight ? ((Number(pureWeight) * currentProba) / targetProba) - Number(pureWeight) : 0;
  const totalMix = pureWeight ? Number(pureWeight) + ligaturaNeeded : 0;

  const expectedPure = (scrapWeight && scrapProba) ? (Number(scrapWeight) * Number(scrapProba)) / 999 : 0;
  const lossWeight = scrapWeight ? Number(scrapWeight) - expectedPure : 0;

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Proba va Ligatura Hisoblagichi</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* 1-KALKULYATOR: PROBA TUSHIRISH */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
          <div className="flex items-center gap-3 mb-6 border-b pb-4">
            <span className="text-2xl">⚖️</span>
            <h2 className="text-xl font-semibold text-gray-800">Proba tushirish (Qotishma)</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Tilla massasi (gr)</label>
              <input type="number" step="0.01" value={pureWeight} onChange={(e) => setPureWeight(Number(e.target.value))} placeholder="Masalan: 50" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-yellow-500 focus:outline-none" />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Joriy proba</label>
                <input type="number" value={currentProba} onChange={(e) => setCurrentProba(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-yellow-500 focus:outline-none bg-gray-50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Kutilayotgan proba</label>
                <input type="number" value={targetProba} onChange={(e) => setTargetProba(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-yellow-500 focus:outline-none bg-gray-50" />
              </div>
            </div>

            {pureWeight !== "" && (
              <div className="mt-6 p-5 bg-yellow-50 rounded-lg border border-yellow-200">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-yellow-800">Qo'shiladigan ligatura (Mis/Rux):</span>
                  <span className="text-xl font-black text-yellow-900">{ligaturaNeeded.toFixed(2)} gr</span>
                </div>
                <div className="flex justify-between items-center border-t border-yellow-200 pt-2">
                  <span className="text-sm font-medium text-yellow-800">Jami tayyor qotishma:</span>
                  <span className="text-lg font-bold text-yellow-900">{totalMix.toFixed(2)} gr</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 2-KALKULYATOR: AFFINAJ (TOZALASH) */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
          <div className="flex items-center gap-3 mb-6 border-b pb-4">
            <span className="text-2xl">🧪</span>
            <h2 className="text-xl font-semibold text-gray-800">Tillani tozalash (Affinaj)</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4 -mt-2">Eski tilla yoki qirindini azot kislotasi va mis bilan qaynatganda chiqadigan sof 999 tilla massasini hisoblash.</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Lom / Qirindi massasi (gr)</label>
              <input type="number" step="0.01" value={scrapWeight} onChange={(e) => setScrapWeight(Number(e.target.value))} placeholder="Masalan: 120" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">Lomning taxminiy probasi</label>
              <input type="number" value={scrapProba} onChange={(e) => setScrapProba(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none bg-gray-50" />
            </div>

            {scrapWeight !== "" && (
              <div className="mt-6 p-5 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-blue-800">Olinadigan sof tilla (999):</span>
                  <span className="text-xl font-black text-blue-900">{expectedPure.toFixed(2)} gr</span>
                </div>
                <div className="flex justify-between items-center border-t border-blue-200 pt-2">
                  <span className="text-sm font-medium text-blue-800">Ajraladigan aralashma (mis, rux):</span>
                  <span className="text-lg font-bold text-red-600">{lossWeight.toFixed(2)} gr</span>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}