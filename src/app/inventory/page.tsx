"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// Supabase ulanishi (Sizning muhitingizdan avtomatik oladi)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function InventoryPage() {
  const [materialName, setMaterialName] = useState("");
  const [grossWeight, setGrossWeight] = useState("");
  const [proba, setProba] = useState("");
  const [unit, setUnit] = useState("Gramm (gr)");
  const [isLoading, setIsLoading] = useState(false);
  const [inventoryStock, setInventoryStock] = useState<any[]>([]);

  // Ombordagi mavjud qoldiqlarni bazadan tortib kelish
  const fetchInventory = async () => {
    const { data, error } = await supabase
      .from("gold_transactions")
      .select("*");

    if (error) {
      console.error("Xatolik:", error);
      return;
    }

    // Tranzaksiyalarni jamlab, aniq qoldiqni hisoblash
    const stockMap: Record<string, any> = {};
    
    data?.forEach((tx) => {
      const key = `${tx.material_name}-${tx.proba || 'yoq'}`;
      if (!stockMap[key]) {
        stockMap[key] = { 
          name: tx.material_name, 
          proba: tx.proba, 
          qty: 0, 
          pure_gold: 0 
        };
      }
      
      if (tx.transaction_type === "kirim") {
        stockMap[key].qty += Number(tx.gross_weight);
        stockMap[key].pure_gold += Number(tx.pure_gold);
      } else if (tx.transaction_type === "chiqim" || tx.transaction_type === "yoqotish") {
        stockMap[key].qty -= Number(tx.gross_weight);
        stockMap[key].pure_gold -= Number(tx.pure_gold);
      }
    });

    setInventoryStock(Object.values(stockMap).filter(item => item.qty > 0));
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  // Yangi xomashyoni bazaga qo'shish (Kirim qilish)
  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!materialName || !grossWeight) return alert("Nomi va miqdorini kiriting!");
    
    setIsLoading(true);

    const weightNum = parseFloat(grossWeight);
    const probaNum = proba ? parseInt(proba) : null;
    
    // Sof oltin formulasini ishlatish (Massa * Proba / 1000)
    let pureGold = 0;
    if (probaNum) {
      pureGold = (weightNum * probaNum) / 1000;
    }

    const { error } = await supabase.from("gold_transactions").insert([
      {
        transaction_type: "kirim",
        material_name: materialName,
        gross_weight: weightNum,
        proba: probaNum,
        pure_gold: pureGold,
        description: "Omborga qo'lda kiritildi"
      }
    ]);

    setIsLoading(false);

    if (error) {
      alert("Xatolik yuz berdi: " + error.message);
    } else {
      // Formani tozalash va ro'yxatni yangilash
      setMaterialName("");
      setGrossWeight("");
      setProba("");
      fetchInventory();
    }
  };

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl font-bold mb-6 text-gray-100">Xomashyo Ombori</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CHAP TOMON: Kiritish Formasi */}
        <div className="bg-[#1e212b] p-6 rounded-2xl shadow-lg border border-gray-800 h-fit">
          <h2 className="text-lg font-semibold mb-4 text-gray-200">Xomashyo kiritish</h2>
          <form onSubmit={handleAddStock} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Nomi</label>
              <input
                type="text"
                value={materialName}
                onChange={(e) => setMaterialName(e.target.value)}
                placeholder="Masalan: Toza tilla"
                className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none text-sm"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Miqdori</label>
                <input
                  type="number"
                  step="0.01"
                  value={grossWeight}
                  onChange={(e) => setGrossWeight(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">O'lchov birligi</label>
                <select 
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none text-sm"
                >
                  <option>Gramm (gr)</option>
                  <option>Litr (l)</option>
                  <option>Dona (d)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Probasi (agar bo'lsa)</label>
              <input
                type="number"
                value={proba}
                onChange={(e) => setProba(e.target.value)}
                placeholder="Masalan: 585 yoki 999"
                className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none text-sm"
              />
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full mt-4 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-orange-600/20 text-sm"
            >
              {isLoading ? "Qo'shilmoqda..." : "Omborga qo'shish"}
            </button>
          </form>
        </div>

        {/* O'NG TOMON: Ombor Qoldig'i (Jadval) */}
        <div className="lg:col-span-2 bg-[#1e212b] p-6 rounded-2xl shadow-lg border border-gray-800">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-semibold text-gray-200">Ombordagi mavjud xomashyolar</h2>
            <button className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all">
              📊 Excelga yuklab olish
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-700">
                  <th className="pb-3 pl-2">Nomi</th>
                  <th className="pb-3 text-right">Massa (Miqdor)</th>
                  <th className="pb-3 text-center">Proba</th>
                  <th className="pb-3 text-right pr-2">Sof Oltin</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {inventoryStock.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-gray-500">Ombor hozircha bo'sh...</td>
                  </tr>
                ) : (
                  inventoryStock.map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-800/50 hover:bg-white/5 transition-colors">
                      <td className="py-4 pl-2 font-medium text-gray-200">{item.name}</td>
                      <td className="py-4 text-right text-emerald-400 font-semibold">{item.qty.toFixed(2)} gr</td>
                      <td className="py-4 text-center">
                        {item.proba ? (
                          <span className="bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded text-xs font-bold border border-yellow-500/30">
                            {item.proba}
                          </span>
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                      <td className="py-4 text-right pr-2 text-yellow-500 font-medium">
                        {item.pure_gold > 0 ? `${item.pure_gold.toFixed(2)} gr` : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}