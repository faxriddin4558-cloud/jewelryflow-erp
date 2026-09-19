"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  
  const [name, setName] = useState("");
  const [weight, setWeight] = useState<number | "">("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [imageUrl, setImageUrl] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // ETIKET (BIRKA) UCHUN STATE
  const [selectedTag, setSelectedTag] = useState<any>(null);

  const supabase = createSupabaseBrowserClient();

  const fetchProducts = async () => {
    const { data } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setProducts(data);
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const defaultImage = "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&q=80&w=500";

    const { error } = await supabase.from("products").insert([
      { 
        name: name, 
        weight: Number(weight), 
        quantity: Number(quantity),
        image_url: imageUrl || defaultImage
      }
    ]);

    if (!error) {
      setMessage("✅ Mahsulot vitrinaga chiroyli qilib qo'shildi!");
      fetchProducts();
      setName(""); setWeight(""); setQuantity(""); setImageUrl("");
    } else {
      setMessage("Xato: " + error.message);
    }
    setLoading(false);
  };

  return (
    <>
      <div className={`p-8 bg-gray-50 min-h-screen ${selectedTag ? 'print:hidden' : ''}`}>
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Tayyor Mahsulotlar (Vitrina)</h1>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-10">
          <h2 className="text-xl font-semibold mb-6 border-b pb-4">Yangi mahsulotni vitrinaga qo'yish</h2>
          
          {message && <div className={`mb-5 p-4 rounded-md font-medium ${message.includes("Xato") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>{message}</div>}
          
          <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700">Mahsulot nomi</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Bismark zanjir" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>
            
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700">Vazni (gr)</label>
              <input type="number" step="0.01" required value={weight} onChange={(e) => setWeight(Number(e.target.value))} placeholder="0.00" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>

            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700">Soni (qoldiq)</label>
              <input type="number" required value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} placeholder="1" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none" />
            </div>

            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700">Rasm linki (URL)</label>
              <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://... (ixtiyoriy)" className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>

            <div className="md:col-span-1">
              <button type="submit" disabled={loading} className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-700">
                {loading ? "Qo'shilmoqda..." : "Vitrinaga qo'yish"}
              </button>
            </div>
          </form>
        </div>

        <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">🖼️ Mahsulotlar Katalogi</h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {products.map((item) => (
            <div key={item.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow duration-300 group flex flex-col">
              
              <div className="h-56 w-full bg-gray-100 relative overflow-hidden">
                <div className="absolute top-3 right-3 z-10">
                  <span className={`px-3 py-1 rounded-full text-xs font-black shadow-sm ${item.quantity > 0 ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                    {item.quantity > 0 ? `${item.quantity} ta bor` : 'Tugagan'}
                  </span>
                </div>
                
                <img 
                  src={item.image_url || "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&q=80&w=500"} 
                  alt={item.name} 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  onError={(e) => { e.currentTarget.src = "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&q=80&w=500"; }}
                />
              </div>
              
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1 truncate" title={item.name}>{item.name}</h3>
                  <div className="flex justify-between items-center mt-3">
                    <div className="text-sm font-medium text-gray-500">Vazni:</div>
                    <div className="text-lg font-black text-indigo-600">{item.weight} gr</div>
                  </div>
                </div>
                
                {/* ETIKET CHIQARISH TUGMASI */}
                <button 
                  onClick={() => setSelectedTag(item)}
                  className="mt-4 w-full bg-gray-100 text-gray-800 py-2 rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 border border-gray-200"
                >
                  🏷️ Etiket (Birka) chiqarish
                </button>
              </div>
              
            </div>
          ))}
        </div>
      </div>

      {/* ETIKET (BIRKA) OYNASI MODAL */}
      {selectedTag && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 print:bg-white print:opacity-100">
          <div className="bg-white p-6 rounded-2xl shadow-2xl print:shadow-none print:p-0">
            
            <h3 className="text-center font-bold text-gray-600 mb-4 print:hidden">Etiketni qog'ozga chiqarish</h3>
            
            {/* HAKIKIY KELEBEK ETIKET TASARIMI (4cm x 2cm boyutlarında) */}
            <div className="w-[80mm] h-[20mm] border-2 border-dashed border-gray-400 flex bg-white mx-auto print:border-none print:w-[80mm] print:h-[20mm] text-black">
              
              {/* Chap qanot (Mahsulot nomi va vazni) */}
              <div className="w-1/2 h-full flex flex-col justify-center items-center border-r-2 border-dotted border-gray-300 px-2 text-center">
                 <span className="text-[10px] font-bold leading-tight truncate w-full">{selectedTag.name}</span>
                 <span className="text-[14px] font-black mt-1">{selectedTag.weight} gr</span>
              </div>
              
              {/* O'ng qanot (Logotip va Seriya raqami) */}
              <div className="w-1/2 h-full flex flex-col justify-center items-center px-2 text-center">
                 <span className="text-[13px] font-black uppercase tracking-widest text-gray-800">JEWELRY</span>
                 <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest leading-none">Flow</span>
                 <span className="text-[7px] text-gray-500 mt-1 font-mono">S/N: {selectedTag.id.toString().padStart(6, '0')}</span>
              </div>

            </div>

            <div className="flex gap-3 mt-8 print:hidden">
              <button onClick={() => window.print()} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-lg font-semibold hover:bg-indigo-700 transition-colors">
                🖨️ Chop etish
              </button>
              <button onClick={() => setSelectedTag(null)} className="flex-1 bg-gray-200 text-gray-800 py-2.5 rounded-lg font-semibold hover:bg-gray-300 transition-colors">
                Yopish
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}