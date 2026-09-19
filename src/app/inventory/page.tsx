"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function InventoryPage() {
  const [inventory, setInventory] = useState<any[]>([]);

  const [materialName, setMaterialName] = useState("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [unit, setUnit] = useState("gr");
  const [purity, setPurity] = useState<number | "">("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const supabase = createSupabaseBrowserClient();

  const fetchInventory = async () => {
    const { data } = await supabase
      .from("inventory")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setInventory(data);
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("inventory").insert([
      { 
        material_name: materialName, 
        quantity: Number(quantity || 0),
        unit: unit,
        purity: purity === "" ? null : Number(purity)
      }
    ]);

    if (!error) {
      setMessage("✅ Xomashyo omborga muvaffaqiyatli kiritildi!");
      fetchInventory();
      setMaterialName(""); setQuantity(""); setPurity("");
    } else {
      setMessage("Xato: " + error.message);
    }
    setLoading(false);
  };

  // EXCEL (CSV) GA YUKLAB OLISH FUNKSIYASI
  const downloadExcel = () => {
    // Jadval sarlavhalari
    const headers = ["Nomi", "Miqdori", "O'lchov birligi", "Probasi", "Kiritilgan sana"];
    
    // Ma'lumotlarni qatorlarga ajratish
    const rows = inventory.map(item => [
      `"${item.material_name}"`, // Vergullar xalaqit bermasligi uchun qo'shtirnoq
      item.quantity,
      item.unit,
      item.purity || "-",
      new Date(item.created_at).toLocaleDateString('uz-UZ')
    ]);

    // CSV formatiga o'tkazish (UTF-8 BOM bilan, krill/lotin harflari to'g'ri chiqishi uchun)
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");

    // Faylni yuklab olish jarayoni
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    // Fayl nomiga bugungi sanani qo'shish
    const dateToday = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `Ombor_Qoldiq_${dateToday}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Xomashyo Ombori</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit col-span-1">
          <h2 className="text-xl font-semibold mb-6 border-b pb-4">Xomashyo kiritish</h2>
          
          {message && <div className={`mb-5 p-4 rounded-md font-medium ${message.includes("Xato") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>{message}</div>}
          
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Nomi</label>
              <input type="text" required value={materialName} onChange={(e) => setMaterialName(e.target.value)} placeholder="Masalan: Toza tilla" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Miqdori</label>
                <input type="number" step="0.01" required value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} placeholder="0" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">O'lchov birligi</label>
                <select value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none">
                  <option value="gr">Gramm (gr)</option>
                  <option value="litr">Litr</option>
                  <option value="ta">Dona (ta)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Probasi (agar bo'lsa)</label>
              <input type="number" value={purity} onChange={(e) => setPurity(e.target.value === "" ? "" : Number(e.target.value))} placeholder="Masalan: 585 yoki 999" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>
            
            <button type="submit" disabled={loading} className="w-full mt-4 rounded-md bg-yellow-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-yellow-700">
              {loading ? "Saqlanmoqda..." : "Omborga qo'shish"}
            </button>
          </form>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 col-span-2">
          {/* Sarlavha va Excel tugmasi qismi */}
          <div className="flex justify-between items-center mb-6 border-b pb-4">
            <h2 className="text-xl font-semibold">Ombordagi mavjud xomashyolar</h2>
            <button 
              onClick={downloadExcel}
              className="bg-green-100 text-green-700 hover:bg-green-200 px-4 py-2 rounded-lg font-bold text-sm transition-colors border border-green-300 flex items-center gap-2"
            >
              <span>📊 Excelga yuklab olish</span>
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Nomi</th>
                  <th className="px-4 py-3">Miqdori</th>
                  <th className="px-4 py-3">Proba</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item, idx) => (
                  <tr key={idx} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-bold text-gray-900">{item.material_name}</td>
                    <td className="px-4 py-3 font-bold text-green-600">{item.quantity} {item.unit}</td>
                    <td className="px-4 py-3">
                      {item.purity ? (
                        <span className="px-2.5 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">
                          {item.purity}
                        </span>
                      ) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}