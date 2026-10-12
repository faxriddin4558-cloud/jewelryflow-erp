"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase,
  GoldEngine,
  RBAC,
  logErpAudit,
  generateIdempotencyKey,
  type ProductRow,
} from "@/lib/erp-engine";

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [name, setName] = useState("");
  const [cat, setCat] = useState("Komplekt");
  const [proba, setProba] = useState("585");
  const [ringW, setRingW] = useState("4.5");
  const [earW, setEarW] = useState("5.2");
  const [chainW, setChainW] = useState("3.3");
  const [dorikaW, setDorikaW] = useState("0.5");
  const [stoneW, setStoneW] = useState("1.0");
  const [bomVer, setBomVer] = useState("1");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setProducts(data as ProductRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalSetWeight = Number(
    (
      (parseFloat(ringW) || 0) +
      (parseFloat(earW) || 0) +
      (parseFloat(chainW) || 0) +
      (parseFloat(dorikaW) || 0) +
      (parseFloat(stoneW) || 0)
    ).toFixed(4)
  );

  // PHASE 7: ATOMIC ZERO-STOCK PRODUCT + BOM DEFINITION (Stock only increases via Stage-25 batch completion)
  const addProductWithBom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!RBAC.can("manage_products") && !RBAC.can("edit_inventory")) {
      alert("Ruxsat yo'q!");
      return;
    }
    const cleanName = name.trim();
    if (!cleanName || totalSetWeight <= 0) {
      alert("Model nomi va BOM komponent vaznlarini kiriting!");
      return;
    }
    const prN = parseInt(proba, 10) || 585;
    const verN = parseInt(bomVer, 10) || 1;
    const stoneNum = Math.max(0, parseFloat(stoneW) || 0);
    if (stoneNum > totalSetWeight) {
      alert("Tosh vazni umumiy komplekt vaznidan katta bo'lishi mumkin emas!");
      return;
    }
    const summary = `v${verN}: Uzuk(${ringW}g) + Zirak(${earW}g) + Zanjir(${chainW}g) + Dorika(${dorikaW}g) + Tosh(${stoneW}g)`;

    const bomItemsPayload = [
      {
        component_name: "Ring (Uzuk)",
        material_category: "Gold",
        weight_per_set: Math.max(0, parseFloat(ringW) || 0),
        proba: prN,
      },
      {
        component_name: "Earring (Zirak)",
        material_category: "Gold",
        weight_per_set: Math.max(0, parseFloat(earW) || 0),
        proba: prN,
      },
      {
        component_name: "Chain/Wire (Zanjir/Sim)",
        material_category: "Wire",
        weight_per_set: Math.max(0, parseFloat(chainW) || 0),
        proba: prN,
      },
      {
        component_name: "Dorika",
        material_category: "Wire",
        weight_per_set: Math.max(0, parseFloat(dorikaW) || 0),
        proba: prN,
      },
      {
        component_name: "Zircon Stone (Tosh)",
        material_category: "Stone",
        weight_per_set: stoneNum,
        proba: 0,
      },
    ];

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("prod-bom");
      const { error } = await supabase.rpc("rpc_create_product_with_bom", {
        p_name: cleanName,
        p_category: cat,
        p_weight: totalSetWeight,
        p_proba: prN,
        p_stone_weight: stoneNum,
        p_bom_version: verN,
        p_bom_details: summary,
        p_image_url:
          "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80",
        p_bom_items: bomItemsPayload,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik model va BOM saqlash rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_create_product_with_bom funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "bom_items",
        recordId: cleanName,
        action: "CREATE_BOM_V" + verN,
        newData: { name: cleanName, totalSetWeight, stock: 0, summary },
      });
      setName("");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        Tayyor Mahsulotlar Ombori &amp; Haqiqiy BOM (Component Versioning)
      </h1>
      <form
        onSubmit={(e) => void addProductWithBom(e)}
        className="bg-white p-5 rounded-2xl border space-y-3 text-sm"
      >
        <div className="flex flex-wrap justify-between items-center border-b pb-2 gap-2">
          <h2 className="font-bold">
            💎 Yangi Model va Strukturali BOM yaratish (Ring + Earring + Chain + Dorika + Stone)
          </h2>
          <span className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-1 rounded-lg font-semibold">
            Boshlang&apos;ich qoldiq: 0 dona (Faqat 25-bosqichdan chiqqan partiyalar qoldiqni oshiradi)
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Model nomi (Komplekt A)"
            className="border rounded-xl p-2 font-bold"
          />
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="border rounded-xl p-2 bg-white font-semibold"
          >
            <option>Komplekt</option>
            <option>Uzuk</option>
            <option>Zirak</option>
            <option>Braslet</option>
          </select>
          <input
            type="number"
            value={proba}
            onChange={(e) => setProba(e.target.value)}
            placeholder="Proba (585)"
            className="border rounded-xl p-2 font-bold"
          />
          <input
            type="number"
            value={bomVer}
            onChange={(e) => setBomVer(e.target.value)}
            placeholder="BOM Version (1)"
            className="border rounded-xl p-2"
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 bg-slate-50 p-3 rounded-xl border text-xs">
          <div>
            <label className="font-bold">Uzuk (Ring gr)</label>
            <input
              type="number"
              step="0.1"
              value={ringW}
              onChange={(e) => setRingW(e.target.value)}
              className="w-full border rounded p-1.5 bg-white mt-1 font-bold"
            />
          </div>
          <div>
            <label className="font-bold">Zirak (Earring gr)</label>
            <input
              type="number"
              step="0.1"
              value={earW}
              onChange={(e) => setEarW(e.target.value)}
              className="w-full border rounded p-1.5 bg-white mt-1 font-bold"
            />
          </div>
          <div>
            <label className="font-bold">Zanjir/Sim (gr)</label>
            <input
              type="number"
              step="0.1"
              value={chainW}
              onChange={(e) => setChainW(e.target.value)}
              className="w-full border rounded p-1.5 bg-white mt-1 font-bold"
            />
          </div>
          <div>
            <label className="font-bold">Dorika (gr)</label>
            <input
              type="number"
              step="0.1"
              value={dorikaW}
              onChange={(e) => setDorikaW(e.target.value)}
              className="w-full border rounded p-1.5 bg-white mt-1 font-bold"
            />
          </div>
          <div>
            <label className="font-bold">Zirkon Tosh (gr)</label>
            <input
              type="number"
              step="0.1"
              value={stoneW}
              onChange={(e) => setStoneW(e.target.value)}
              className="w-full border rounded p-1.5 bg-white mt-1 font-bold"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg"
            >
              + BOM &amp; Model ({totalSetWeight.toFixed(2)}g)
            </button>
          </div>
        </div>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {products.map((p, i) => {
          const w = Number(p.weight ?? 0);
          const pr = Number(p.proba ?? 585);
          const st = Number(p.stock ?? p.quantity ?? 0);
          const netGoldW = Math.max(0, w - Number(p.stone_weight ?? 0));
          const fine = GoldEngine.toFineGold(netGoldW, pr);
          return (
            <div key={i} className="bg-white p-4 rounded-2xl border space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                  BOM v{p.bom_version ?? 1} | {pr} proba
                </span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    st > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  }`}
                >
                  {st} dona bor
                </span>
              </div>
              <h3 className="font-bold text-lg">{p.name || p.title || "Komplekt"}</h3>
              <div className="text-xs flex justify-between border-t pt-2">
                <span>
                  Jami vazn: <b>{w.toFixed(2)} gr</b>
                </span>
                <span>
                  Sof oltin (999): <b className="text-amber-700">{fine.toFixed(2)} gr</b>
                </span>
              </div>
              <div className="text-[11px] bg-slate-50 p-2 rounded border text-slate-600">
                {p.bom_details || "Uzuk + Zirak + Zanjir + Dorika + Tosh"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
