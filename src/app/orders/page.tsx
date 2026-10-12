"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase,
  GoldEngine,
  RBAC,
  logErpAudit,
  generateIdempotencyKey,
  type OrderRow,
  type InventoryItemRow,
  type EmployeeRow,
} from "@/lib/erp-engine";

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [inv, setInv] = useState<InventoryItemRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [master, setMaster] = useState(() => RBAC.getCurrentUser().name);
  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [model, setModel] = useState("");
  const [proba, setProba] = useState("585");
  const [qty, setQty] = useState("10");
  const [gram, setGram] = useState("150");
  const [price, setPrice] = useState("95000000");
  const [advance, setAdvance] = useState("20000000");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const [oRes, iRes, eRes] = await Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: false }),
      supabase.from("inventory_items").select("*"),
      supabase.from("employees").select("*"),
    ]);
    if (oRes.data) setOrders(oRes.data as OrderRow[]);
    if (iRes.data) setInv(iRes.data as InventoryItemRow[]);
    if (eRes.data) {
      const empList = eRes.data as EmployeeRow[];
      setEmployees(empList);
      if (empList.length > 0 && master === "Unverified Session") {
        const firstEmpName = empList[0]?.name || empList[0]?.full_name;
        if (firstEmpName) setMaster(firstEmpName);
      }
    }
  }, [master]);

  useEffect(() => {
    void load();
  }, [load]);

  const addOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!RBAC.can("edit_sales")) {
      alert("Ruxsat yo'q!");
      return;
    }
    const cleanClient = client.trim();
    const cleanModel = model.trim() || "Komplekt";
    const probaNum = parseInt(proba, 10) || 585;
    const qtyNum = parseInt(qty, 10) || 0;
    const gramNum = parseFloat(gram) || 0;
    const priceNum = parseFloat(price) || 0;
    const advNum = parseFloat(advance) || 0;

    if (!cleanClient || qtyNum <= 0 || gramNum <= 0 || priceNum < 0 || advNum < 0) {
      alert("Mijoz ismi, miqdor, vazn va narxni to'g'ri kiriting!");
      return;
    }
    if (advNum > priceNum) {
      alert("XATO: Avans summasi umumiy buyurtma narxidan katta bo'lishi mumkin emas!");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const ordNo = `Z-${Date.now().toString().slice(-6)}`;
      const { data: newOrd, error } = await supabase
        .from("orders")
        .insert([
          {
            order_no: ordNo,
            order_number: ordNo,
            client_name: cleanClient,
            customer_name: cleanClient,
            phone: phone.trim(),
            product_model: cleanModel,
            details: `${cleanModel} (${probaNum} proba, ${gramNum}g)`,
            proba: probaNum,
            qty: qtyNum,
            weight_gram: gramNum,
            total_price: priceNum,
            advance: advNum,
            deadline: deadline || null,
            priority,
            priority_label: priority,
            status: "Kutilmoqda",
            status_label: "Kutilmoqda",
          },
        ])
        .select()
        .single();

      if (error) {
        alert(`Buyurtmani saqlashda xatolik: ${error.message}`);
        return;
      }

      await logErpAudit({
        table: "orders",
        recordId: ordNo,
        action: "CREATE_ORDER",
        newData: newOrd as Record<string, unknown>,
      });
      setClient("");
      setPhone("");
      setModel("");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // 3-BAND: ORDER -> BOM -> BATCH -> 25 STAGE WIP -> GOLD LEDGER CHAIN (Supports Order-Reserved Gold)
  const launchProductionChain = async (ord: OrderRow) => {
    if (busyRef.current || busy) return;
    if (!RBAC.can("create_batch")) {
      alert("Ruxsat yo'q! Faqat Production Manager yoki Supervisor partiya ocha oladi.");
      return;
    }
    if (
      ord.batch_created ||
      ord.status === "Ishlab chiqarishda" ||
      ord.status === "Bekor qilindi"
    ) {
      alert("Ushbu buyurtma uchun partiya allaqachon ochilgan yoki bekor qilingan!");
      return;
    }

    const qN = Number(ord.qty ?? 0);
    const gN = Number(ord.weight_gram ?? 0);
    const pN = Number(ord.proba ?? 585);
    if (qN <= 0 || gN <= 0) {
      alert("Buyurtmada miqdor yoki oltin vazni ko'rsatilmagan!");
      return;
    }

    const sourceGold = inv.find((x) => x.category === "Gold" && Number(x.proba) === pN);
    if (!sourceGold) {
      alert(
        `SAFE omborida ${pN} probali oltin yozuvi topilmadi! Manba inventarsiz partiya ochish taqiqlangan.`
      );
      return;
    }
    const orderReserved = Number(ord.reserved_gold_gram ?? 0);
    const availGold =
      Number(sourceGold.on_hand || 0) - Number(sourceGold.reserved || 0) + orderReserved;
    if (availGold < gN) {
      alert(
        `SAFE omborida yetarli ${pN} probali oltin yo'q! Mavjud (buyurtma rezervi bilan): ${availGold.toFixed(
          2
        )} gr, Talab: ${gN.toFixed(2)} gr.`
      );
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const bNo = `P-${
        ord.order_no ? ord.order_no.replace("Z-", "") : Date.now().toString().slice(-6)
      }`;
      const idempotencyKey = generateIdempotencyKey(`order-chain-${ord.id || bNo}`);
      const { error } = await supabase.rpc("rpc_launch_order_production_chain", {
        p_order_id: ord.id,
        p_source_item_id: sourceGold.id,
        p_batch_no: bNo,
        p_product_name: ord.product_model || ord.details || "Komplekt",
        p_client_name: ord.client_name || ord.customer_name || "",
        p_master_name: master,
        p_proba: pN,
        p_planned_qty: qN,
        p_issued_gold_gram: gN,
        p_pure_gold: GoldEngine.toPureGold(gN, pN),
        p_priority: ord.priority || "Normal",
        p_deadline: ord.deadline || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik ishlab chiqarish zanjiri rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_launch_order_production_chain funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "orders",
        recordId: bNo,
        action: "ORDER_TO_BATCH_CHAIN",
        newData: { order: ord.order_no, batch: bNo, sourceItemId: sourceGold.id, qN, gN, master },
      });
      alert(
        `Zanjir yaratildi: Buyurtma -> ${bNo} Partiya -> Quyish WIP (${qN} komplekt / ${gN}g) -> Gold Ledger!`
      );
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const cancelOrderAndReleaseReservation = async (ord: OrderRow) => {
    if (busyRef.current || busy) return;
    if (!RBAC.can("edit_sales") && !RBAC.can("edit_inventory")) {
      alert("Ruxsat yo'q!");
      return;
    }
    const reservedG = Number(ord.reserved_gold_gram ?? 0);
    busyRef.current = true;
    setBusy(true);
    try {
      if (reservedG > 0 && ord.reserved_item_id) {
        const pN = Number(ord.proba ?? 585);
        const { error: unresError } = await supabase.rpc("rpc_inventory_transaction", {
          p_item_id: ord.reserved_item_id,
          p_tx_type: "unreserve",
          p_weight: reservedG,
          p_proba: pN,
          p_pure_gold: GoldEngine.toPureGold(reservedG, pN),
          p_from_location: "RESERVED",
          p_to_location: "SAFE",
          p_description: `Buyurtma bekor qilindi (${ord.order_no || ""})`,
          p_order_id: ord.id,
          p_order_no: ord.order_no,
          p_idempotency_key: generateIdempotencyKey(`cancel-ord-${ord.id || ""}`),
        });
        if (unresError) {
          alert(`Rezervni bo'shatishda xatolik: ${unresError.message}`);
          return;
        }
      }
      const { error: updError } = await supabase
        .from("orders")
        .update({ status: "Bekor qilindi", status_label: "Bekor qilindi", reserved_gold_gram: 0 })
        .eq("id", ord.id);
      if (updError) {
        alert(`Buyurtmani bekor qilishda xatolik: ${updError.message}`);
        return;
      }
      await logErpAudit({
        table: "orders",
        recordId: String(ord.id || ord.order_no || ""),
        action: "CANCEL_ORDER",
        newData: { orderNo: ord.order_no, releasedReservedGram: reservedG },
      });
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const getDeadlineBadge = (dl?: string | null) => {
    if (!dl) return <span className="text-slate-400">-</span>;
    const diffDays = Math.ceil((new Date(dl).getTime() - Date.now()) / (1000 * 3600 * 24));
    if (diffDays < 0)
      return (
        <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold text-xs">
          🔴 CRITICAL ({dl})
        </span>
      );
    if (diffDays <= 3)
      return (
        <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold text-xs">
          🟡 WARNING ({dl})
        </span>
      );
    return <span className="text-slate-700 font-semibold text-xs">{dl}</span>;
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        Mijozlar va Buyurtmalar (Order → BOM → Batch Chain)
      </h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={(e) => void addOrder(e)}
          className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit"
        >
          <h2 className="font-bold border-b pb-2">
            Yangi Buyurtma (Avans avtomatik Kassaga tushadi)
          </h2>
          <input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Mijoz ismi"
            className="w-full border rounded-xl p-2 font-bold"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998 90..."
              className="border rounded-xl p-2"
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="border rounded-xl p-2 bg-white font-bold"
            >
              <option value="Normal">NORMAL</option>
              <option value="VIP">🟡 VIP</option>
              <option value="URGENT">🔴 URGENT</option>
            </select>
          </div>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model / Komplekt nomi"
            className="w-full border rounded-xl p-2"
          />
          <div>
            <label className="text-[11px] text-slate-500">Ishlab chiqarish mas&apos;ul ustasi</label>
            <input
              list="ord-emp-list"
              value={master}
              onChange={(e) => setMaster(e.target.value)}
              className="w-full border rounded-xl p-2 font-bold"
            />
            <datalist id="ord-emp-list">
              {employees.map((em, idx) => (
                <option key={idx} value={em.name || em.full_name} />
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-slate-500">Proba</label>
              <input
                type="number"
                value={proba}
                onChange={(e) => setProba(e.target.value)}
                className="w-full border rounded-xl p-2 font-bold"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Soni (dona)</label>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full border rounded-xl p-2 font-bold"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Vazni (gr)</label>
              <input
                type="number"
                value={gram}
                onChange={(e) => setGram(e.target.value)}
                className="w-full border rounded-xl p-2 font-bold"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500">Jami narx (so&apos;m)</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full border rounded-xl p-2 font-bold"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Avans (so&apos;m)</label>
              <input
                type="number"
                value={advance}
                onChange={(e) => setAdvance(e.target.value)}
                className="w-full border rounded-xl p-2 font-bold text-emerald-700"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Topshirish muddati (Deadline)</label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full border rounded-xl p-2 mt-1"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-xl"
          >
            Buyurtmani saqlash
          </button>
        </form>

        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500 bg-slate-50 border-b">
                <th className="p-2.5">Mijoz / Priority</th>
                <th className="p-2.5">Model / Vazn</th>
                <th className="p-2.5">Avans / Qoldiq Qarz</th>
                <th className="p-2.5">Deadline</th>
                <th className="p-2.5 text-center">Production Chain</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const rem = Math.max(0, Number(o.total_price ?? 0) - Number(o.advance ?? 0));
                const isCancelled = o.status === "Bekor qilindi";
                return (
                  <tr key={i} className="border-b hover:bg-slate-50">
                    <td className="p-2.5">
                      <b>{o.client_name || o.customer_name}</b>{" "}
                      <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-bold">
                        {o.priority || "NORMAL"}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <b>{o.product_model || o.details}</b>
                      <div className="text-xs text-slate-500">
                        {o.qty ?? 0} dona | {o.weight_gram ?? 0} gr ({o.proba ?? 585})
                      </div>
                    </td>
                    <td className="p-2.5">
                      <div className="text-emerald-600 font-bold">
                        +{Number(o.advance ?? 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-red-600">Qoldiq: {rem.toLocaleString()}</div>
                    </td>
                    <td className="p-2.5">{getDeadlineBadge(o.deadline)}</td>
                    <td className="p-2.5 text-center">
                      {isCancelled ? (
                        <span className="bg-red-100 text-red-700 px-2.5 py-1 rounded-full text-xs font-bold">
                          ✕ Bekor qilindi
                        </span>
                      ) : o.batch_created || o.status === "Ishlab chiqarishda" ? (
                        <span className="bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full text-xs font-bold">
                          ⚙️ Ishlab chiqarishda
                        </span>
                      ) : (
                        <div className="flex gap-1.5 justify-center">
                          <button
                            onClick={() => void launchProductionChain(o)}
                            disabled={busy}
                            className="bg-purple-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
                          >
                            ⚙️ Partiya &amp; WIP →
                          </button>
                          <button
                            onClick={() => void cancelOrderAndReleaseReservation(o)}
                            disabled={busy}
                            className="bg-slate-200 hover:bg-red-100 text-slate-700 hover:text-red-700 text-xs font-bold px-2 py-1.5 rounded-lg"
                            title="Buyurtmani bekor qilish va oltin rezervini qaytarish"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
