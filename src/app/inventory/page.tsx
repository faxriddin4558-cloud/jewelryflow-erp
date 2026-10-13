"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase,
  GoldEngine,
  RBAC,
  logErpAudit,
  generateIdempotencyKey,
  type InventoryItemRow,
  type GoldTransactionRow,
  type OrderRow,
} from "@/lib/erp-engine";

const CATEGORIES = [
  "Gold",
  "Scrap",
  "Alloy",
  "Silver",
  "Copper",
  "Wax",
  "Resin",
  "Investment",
  "Stone",
  "Chain",
  "Wire",
  "Other",
];

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [ledger, setLedger] = useState<GoldTransactionRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [name, setName] = useState("");
  const [cat, setCat] = useState("Gold");
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState("gr");
  const [proba, setProba] = useState("999");
  const [txType, setTxType] = useState<"kirim" | "chiqim" | "reserve" | "unreserve">("kirim");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [fromLoc, setFromLoc] = useState("SUPPLIER");
  const [toLoc, setToLoc] = useState("SAFE");
  const [reason, setReason] = useState("");
  const [showNewCard, setShowNewCard] = useState(false);
  const [newCardName, setNewCardName] = useState("");
  const [newCardCat, setNewCardCat] = useState("Gold");
  const [newCardProba, setNewCardProba] = useState("585");
  const [newCardUnit, setNewCardUnit] = useState("gr");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const [iRes, lRes, oRes] = await Promise.all([
      supabase.from("inventory_items").select("*").order("category"),
      supabase.from("gold_transactions").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("orders").select("*").order("created_at", { ascending: false }),
    ]);
    if (iRes.data) setItems(iRes.data as InventoryItemRow[]);
    if (lRes.data) setLedger(lRes.data as GoldTransactionRow[]);
    if (oRes.data) setOrders(oRes.data as OrderRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRegisterCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!RBAC.can("edit_inventory")) {
      alert("Ruxsat yo'q! Faqat Warehouse yoki Director yangi material kartochkasini ocha oladi.");
      return;
    }
    const cleanCardName = newCardName.trim();
    const cardProba = parseInt(newCardProba, 10) || 0;
    if (!cleanCardName || cardProba < 0 || cardProba > 1000) {
      alert("Material nomi va to'g'ri probani (0-1000) kiriting!");
      return;
    }
    const exists = items.some(
      (x) =>
        (x.name || "").trim().toLowerCase() === cleanCardName.toLowerCase() &&
        Number(x.proba ?? 0) === cardProba
    );
    if (exists) {
      alert(`"${cleanCardName}" (${cardProba} proba) kartochkasi omborda allaqachon mavjud!`);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const matCode = `MAT-${newCardCat.slice(0, 3).toUpperCase()}-${cardProba}-${Date.now().toString().slice(-4)}`;
      const { data: created, error } = await supabase
        .from("inventory_items")
        .insert([
          {
            material_code: matCode,
            name: cleanCardName,
            category: newCardCat,
            unit: newCardUnit || "gr",
            proba: cardProba,
            on_hand: 0,
            reserved: 0,
          },
        ])
        .select()
        .single();

      if (error) {
        alert(`Material kartochkasini ro'yxatdan o'tkazishda xatolik: ${error.message}`);
        return;
      }

      await logErpAudit({
        table: "inventory_items",
        recordId: matCode,
        action: "REGISTER_MATERIAL_CARD",
        newData: created as Record<string, unknown>,
      });
      setName(cleanCardName);
      setCat(newCardCat);
      setProba(String(cardProba));
      setUnit(newCardUnit || "gr");
      setNewCardName("");
      setShowNewCard(false);
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!RBAC.can("edit_inventory")) {
      alert("Ruxsat yo'q! Faqat Warehouse yoki Director o'zgartira oladi.");
      return;
    }
    const cleanName = name.trim();
    const wNum = parseFloat(weight) || 0;
    const pNum = parseInt(proba, 10) || 0;
    if (!cleanName || wNum <= 0) {
      alert("Nomi va 0 dan katta miqdorni kiriting!");
      return;
    }

    const ex = items.find(
      (x) =>
        (x.name || "").trim().toLowerCase() === cleanName.toLowerCase() &&
        Number(x.proba ?? 0) === pNum
    );
    if (!ex) {
      alert(
        `XATO: Omborda "${cleanName}" (${pNum} proba) yozuvi topilmadi! Avval yuqoridagi "+ Yangi Material Kartochkasi" tugmasi orqali 0 qoldiqli kartochkani ro'yxatdan o'tkazing.`
      );
      return;
    }

    const onH = Number(ex.on_hand ?? 0);
    const res = Number(ex.reserved ?? 0);
    const avail = onH - res;
    if ((txType === "chiqim" || txType === "reserve") && wNum > avail) {
      alert(
        `XATO (Negative Inventory Guard): Omborda faqat ${avail.toFixed(2)} ${
          ex.unit || unit
        } AVAILABLE bor!`
      );
      return;
    }
    if (txType === "unreserve" && wNum > res) {
      alert(
        `XATO: Rezervdan chiqarish miqdori (${wNum.toFixed(2)}) joriy rezervdan (${res.toFixed(
          2
        )}) katta bo'lishi mumkin emas!`
      );
      return;
    }

    const ordObj = orders.find((o) => String(o.id) === selectedOrderId);

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("inv-tx");
      const { error } = await supabase.rpc("rpc_inventory_transaction", {
        p_item_id: ex.id,
        p_tx_type: txType,
        p_weight: wNum,
        p_proba: pNum,
        p_pure_gold: GoldEngine.toPureGold(wNum, pNum),
        p_from_location: txType === "kirim" ? fromLoc : "SAFE",
        p_to_location: txType === "kirim" ? "SAFE" : toLoc,
        p_description:
          reason ||
          `${txType}: ${fromLoc}->${toLoc}${ordObj ? ` (Order ${ordObj.order_no || ""})` : ""}`,
        p_order_id: ordObj?.id != null ? String(ordObj.id) : null,
        p_order_no: ordObj?.order_no ?? null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik ombor amaliyoti rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_inventory_transaction funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "inventory_items",
        recordId: String(ex.id),
        action: txType.toUpperCase(),
        newData: {
          itemId: ex.id,
          name: ex.name,
          wNum,
          pNum,
          txType,
          orderId: ordObj?.id ?? null,
        },
      });
      setName("");
      setWeight("");
      setReason("");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">
          Xomashyo Ombori (ON HAND / RESERVED / AVAILABLE) &amp; Gold Ledger
        </h1>
        <button
          type="button"
          onClick={() => setShowNewCard((v) => !v)}
          className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl"
        >
          {showNewCard ? "✕ Yopish" : "➕ Yangi Material Kartochkasi (0 qoldiq)"}
        </button>
      </div>

      {showNewCard && (
        <form
          onSubmit={(e) => void handleRegisterCard(e)}
          className="bg-amber-50 border border-amber-200 p-4 rounded-2xl grid grid-cols-1 md:grid-cols-5 gap-3 text-sm items-end"
        >
          <div>
            <label className="text-xs font-bold text-amber-900">Toifa (Category)</label>
            <select
              value={newCardCat}
              onChange={(e) => setNewCardCat(e.target.value)}
              className="w-full border rounded-xl p-2 bg-white font-bold mt-1"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-amber-900">Material nomi</label>
            <input
              value={newCardName}
              onChange={(e) => setNewCardName(e.target.value)}
              placeholder="Masalan: Oltin 585 yoki Lom 585"
              className="w-full border rounded-xl p-2 bg-white font-bold mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-amber-900">Proba (0-1000)</label>
            <input
              type="number"
              value={newCardProba}
              onChange={(e) => setNewCardProba(e.target.value)}
              className="w-full border rounded-xl p-2 bg-white font-bold mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-amber-900">O&apos;lchov birligi</label>
            <input
              value={newCardUnit}
              onChange={(e) => setNewCardUnit(e.target.value)}
              placeholder="gr"
              className="w-full border rounded-xl p-2 bg-white mt-1"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 px-4 rounded-xl"
          >
            Kartochkani ochish (0 gr)
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={(e) => void handleTx(e)}
          className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit"
        >
          <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setTxType("kirim")}
              className={`py-2 rounded-lg ${txType === "kirim" ? "bg-emerald-600 text-white" : ""}`}
            >
              + Kirim
            </button>
            <button
              type="button"
              onClick={() => setTxType("chiqim")}
              className={`py-2 rounded-lg ${txType === "chiqim" ? "bg-red-600 text-white" : ""}`}
            >
              - Chiqim
            </button>
            <button
              type="button"
              onClick={() => setTxType("reserve")}
              className={`py-2 rounded-lg ${txType === "reserve" ? "bg-amber-600 text-white" : ""}`}
            >
              🔒 Rezerv
            </button>
            <button
              type="button"
              onClick={() => setTxType("unreserve")}
              className={`py-2 rounded-lg ${txType === "unreserve" ? "bg-blue-600 text-white" : ""}`}
            >
              🔓 Yechish
            </button>
          </div>
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="w-full border rounded-xl p-2 bg-white font-bold"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            list="inv-items-list"
            value={name}
            onChange={(e) => {
              const val = e.target.value;
              setName(val);
              const matched = items.find(
                (it) => (it.name || "").trim().toLowerCase() === val.trim().toLowerCase()
              );
              if (matched) {
                if (matched.category) setCat(matched.category);
                if (matched.proba !== undefined) setProba(String(matched.proba));
                if (matched.unit) setUnit(matched.unit);
              }
            }}
            placeholder="Material nomi (Toza oltin 988)"
            className="w-full border rounded-xl p-2 font-bold"
          />
          <datalist id="inv-items-list">
            {items.map((it, idx) => (
              <option key={idx} value={it.name} />
            ))}
          </datalist>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              step="0.01"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="Miqdor"
              className="border rounded-xl p-2 font-bold"
            />
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="gr/dona"
              className="border rounded-xl p-2"
            />
            <input
              type="number"
              value={proba}
              onChange={(e) => setProba(e.target.value)}
              placeholder="Proba"
              className="border rounded-xl p-2 font-bold"
            />
          </div>
          {(txType === "reserve" || txType === "unreserve") && (
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="w-full border rounded-xl p-2 bg-amber-50 text-xs font-bold"
            >
              <option value="">-- Buyurtmaga bog&apos;lash (ixtiyoriy) --</option>
              {orders.map((o, idx) => (
                <option key={o.id || idx} value={String(o.id || "")}>
                  {o.order_no || "Buyurtma"} — {o.client_name || o.customer_name} (
                  {o.weight_gram ?? 0}g @ {o.proba ?? 585})
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input
              value={fromLoc}
              onChange={(e) => setFromLoc(e.target.value)}
              placeholder="From (SAFE)"
              className="border rounded-xl p-2 text-xs"
            />
            <input
              value={toLoc}
              onChange={(e) => setToLoc(e.target.value)}
              placeholder="To (CASTING)"
              className="border rounded-xl p-2 text-xs"
            />
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Sabab / Partiya No"
            className="w-full border rounded-xl p-2 text-xs"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-orange-600 text-white font-bold py-2.5 rounded-xl"
          >
            Tasdiqlash
          </button>
        </form>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-5 rounded-2xl border">
            <h2 className="font-bold mb-3">
              Real Qoldiqlar (ON HAND / RESERVED / AVAILABLE)
            </h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500 bg-slate-50 border-b">
                  <th className="p-2">Material</th>
                  <th className="p-2 text-right">ON HAND</th>
                  <th className="p-2 text-right">RESERVED</th>
                  <th className="p-2 text-right">AVAILABLE</th>
                  <th className="p-2 text-right">Fine Gold (999)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const onH = Number(it.on_hand ?? 0);
                  const res = Number(it.reserved ?? 0);
                  const av = Math.max(0, onH - res);
                  return (
                    <tr key={i} className="border-b">
                      <td className="p-2">
                        <b>{it.name}</b>{" "}
                        <span className="text-xs text-slate-400">
                          ({it.category} / {it.proba})
                        </span>
                      </td>
                      <td className="p-2 text-right font-semibold">
                        {onH.toFixed(2)} {it.unit}
                      </td>
                      <td className="p-2 text-right text-amber-600">{res.toFixed(2)}</td>
                      <td className="p-2 text-right font-black text-emerald-600">
                        {av.toFixed(2)} {it.unit}
                      </td>
                      <td className="p-2 text-right font-bold text-amber-700">
                        {GoldEngine.toFineGold(onH, it.proba).toFixed(2)} g
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-white p-5 rounded-2xl border">
            <h3 className="font-bold text-sm mb-2">
              🔗 Gold Movement Ledger (SAFE → CASTING → WIP → AFFINAJ)
            </h3>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b">
                  <th className="p-2">Sana</th>
                  <th className="p-2">Yo&apos;nalish</th>
                  <th className="p-2">Material</th>
                  <th className="p-2 text-right">Massa</th>
                  <th className="p-2 text-right">Sof 999</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-2">
                      {l.created_at ? new Date(l.created_at).toLocaleDateString("uz-UZ") : "-"}
                    </td>
                    <td className="p-2 font-bold text-blue-700">
                      {l.from_location || "SAFE"} → {l.to_location || "WIP"}
                    </td>
                    <td className="p-2">{l.material_name}</td>
                    <td className="p-2 text-right font-bold">
                      {Number(l.gross_weight ?? 0).toFixed(2)}g ({l.proba})
                    </td>
                    <td className="p-2 text-right font-bold text-amber-700">
                      {Number(l.pure_gold ?? 0).toFixed(2)}g
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
