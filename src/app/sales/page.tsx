"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase,
  GoldEngine,
  RBAC,
  logErpAudit,
  generateIdempotencyKey,
  type SaleRow,
  type ProductRow,
  type OrderRow,
} from "@/lib/erp-engine";

export default function SalesPage() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [client, setClient] = useState("");
  const [prodName, setProdName] = useState("Komplekt");
  const [qty, setQty] = useState("1");
  const [weight, setWeight] = useState("14.5");
  const [proba, setProba] = useState("585");
  const [payType, setPayType] = useState("Naqd pul");
  const [totalPrice, setTotalPrice] = useState("18500000");
  const [paidAmount, setPaidAmount] = useState("18500000");
  const [txType, setTxType] = useState<"kirim" | "chiqim" | "debt_repayment">("kirim");
  const [debtTargetRef, setDebtTargetRef] = useState("");
  const [receipt, setReceipt] = useState<SaleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const [s, p, o] = await Promise.all([
      supabase.from("sales").select("*").order("created_at", { ascending: false }),
      supabase.from("products").select("*"),
      supabase.from("orders").select("*"),
    ]);
    if (s.data) setSales(s.data as SaleRow[]);
    if (p.data) setProducts(p.data as ProductRow[]);
    if (o.data) setOrders(o.data as OrderRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totNum = parseFloat(totalPrice) || 0;
  const paidNum = parseFloat(paidAmount) || 0;
  const remDebt = Math.max(0, totNum - paidNum);

  const debtSales = sales.filter((s) => Number(s.debt_amount ?? 0) > 0 && s.tx_type !== "chiqim");
  const debtOrders = orders.filter((o) => {
    const st = (o.status || "").trim().toLowerCase();
    if (st === "bekor qilindi" || st === "cancelled") return false;
    return Math.max(0, Number(o.total_price ?? 0) - Number(o.advance ?? 0)) > 0;
  });

  const handleSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!RBAC.can("edit_sales")) {
      alert("Ruxsat yo'q! Faqat Accountant yoki Director sotuv/kassa yoza oladi.");
      return;
    }

    // Dedicated Debt Repayment Flow (NEVER deducts product stock again)
    if (txType === "debt_repayment") {
      if (!debtTargetRef || paidNum <= 0) {
        alert("Qarzdor sotuv/buyurtmani tanlang va to'lov summasini 0 dan katta kiriting!");
        return;
      }
      const isSaleRef = debtTargetRef.startsWith("sale:");
      const targetId = debtTargetRef.replace(/^(sale:|order:)/, "");

      if (isSaleRef) {
        const targetSale = debtSales.find((s) => String(s.id) === targetId);
        const curDebt = Number(targetSale?.debt_amount ?? 0);
        if (!targetSale || curDebt <= 0) {
          alert("Tanlangan sotuv bo'yicha qarz topilmadi!");
          return;
        }
        if (paidNum > curDebt) {
          alert(
            `XATO (Over-Repayment Guard): To'lov summasi (${paidNum.toLocaleString()}) joriy qarzdan (${curDebt.toLocaleString()}) katta bo'lishi mumkin emas!`
          );
          return;
        }
      } else {
        const targetOrd = debtOrders.find((o) => String(o.id) === targetId);
        const curDebt = Math.max(
          0,
          Number(targetOrd?.total_price ?? 0) - Number(targetOrd?.advance ?? 0)
        );
        if (!targetOrd || curDebt <= 0) {
          alert("Tanlangan buyurtma bo'yicha qarz topilmadi!");
          return;
        }
        if (paidNum > curDebt) {
          alert(
            `XATO (Over-Repayment Guard): To'lov summasi (${paidNum.toLocaleString()}) buyurtma qarzidan (${curDebt.toLocaleString()}) katta bo'lishi mumkin emas!`
          );
          return;
        }
      }

      busyRef.current = true;
      setBusy(true);
      try {
        const idempotencyKey = generateIdempotencyKey("debt-repay");
        const { error } = await supabase.rpc("rpc_record_debt_repayment", {
          p_sale_id: isSaleRef ? targetId : null,
          p_order_id: !isSaleRef ? targetId : null,
          p_payment_type: payType,
          p_repaid_amount: paidNum,
          p_amount: paidNum,
          p_note: client.trim() || "Mijoz qarz to'lovi (mahsulot omboridan qayta yechilmaydi)",
          p_idempotency_key: idempotencyKey,
        });

        if (error) {
          alert(
            `Atomik qarz to'lovi rad etildi: ${error.message}. Iltimos, rpc_record_debt_repayment funksiyasi bazada o'rnatilganligini tekshiring.`
          );
          return;
        }

        await logErpAudit({
          table: "debt_repayments",
          recordId: targetId,
          action: "DEBT_REPAYMENT",
          newData: { debtTargetRef, paidNum, payType },
        });
        alert(
          `Qarz to'lovi (${paidNum.toLocaleString()} so'm) kassaga kirim qilindi va mijoz qarzidan chegirildi (mahsulot qoldig'i o'zgarmadi)!`
        );
        setDebtTargetRef("");
        setClient("");
        await load();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }

    const cleanClient = client.trim();
    const cleanProdName = prodName.trim();
    if (!cleanClient || totNum <= 0 || paidNum < 0) {
      alert("Mijoz va summani to'g'ri kiriting!");
      return;
    }
    if (paidNum > totNum) {
      alert("XATO (Payment Guard): To'langan summa umumiy narxdan katta bo'lishi mumkin emas!");
      return;
    }

    const qNum = parseInt(qty, 10) || 0;
    const weightNum = parseFloat(weight) || 0;
    const probaNum = parseInt(proba, 10) || 585;

    if (txType === "kirim") {
      if (qNum <= 0) {
        alert("Sotilayotgan mahsulot soni 0 dan katta bo'lishi shart!");
        return;
      }
      const prodObj = products.find(
        (p) => (p.name || "").trim().toLowerCase() === cleanProdName.toLowerCase()
      );
      if (!prodObj) {
        alert(
          `XATO: Vitrinada "${cleanProdName}" nomli mahsulot topilmadi! Omborda yo'q mahsulotni sotish taqiqlangan.`
        );
        return;
      }
      const curStock = Number(prodObj.stock ?? prodObj.quantity ?? 0);
      if (qNum > curStock) {
        alert(
          `XATO (Negative Stock Guard): Vitrinada "${prodObj.name}" dan faqat ${curStock} dona bor!`
        );
        return;
      }

      busyRef.current = true;
      setBusy(true);
      try {
        const idempotencyKey = generateIdempotencyKey("sale-kirim");
        const { error } = await supabase.rpc("rpc_record_sale_with_stock_deduction", {
          p_product_id: prodObj.id != null ? String(prodObj.id) : null,
          p_client_name: cleanClient,
          p_product_name: prodObj.name,
          p_quantity: qNum,
          p_weight: weightNum > 0 ? weightNum : Number(prodObj.weight ?? 0),
          p_proba: probaNum,
          p_payment_type: payType,
          p_paid_amount: paidNum,
          p_debt_amount: remDebt,
          p_idempotency_key: idempotencyKey,
        });

        if (error) {
          alert(
            `Atomik sotuv tranzaksiyasi rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_record_sale_with_stock_deduction funksiyasi bazada o'rnatilganligini tekshiring.`
          );
          return;
        }

        await logErpAudit({
          table: "sales",
          action: "SALE_KIRIM",
          newData: {
            productId: prodObj.id,
            client: cleanClient,
            prodName: prodObj.name,
            qty: qNum,
            paidNum,
            remDebt,
          },
        });
        setClient("");
        await load();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("sale-chiqim");
      const { error } = await supabase.from("sales").insert([
        {
          client_name: cleanClient,
          product_name: "Kassa Xarajati (Chiqim)",
          quantity: 1,
          weight: 0,
          proba: probaNum,
          payment_type: payType,
          total_amount: paidNum,
          debt_amount: 0,
          tx_type: "chiqim",
          idempotency_key: idempotencyKey,
        },
      ]);
      if (error) {
        alert(`Chiqimni saqlashda xatolik: ${error.message}`);
        return;
      }
      await logErpAudit({
        table: "sales",
        action: "SALE_CHIQIM",
        newData: { client: cleanClient, paidNum },
      });
      setClient("");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const {
    kassaIn: totalIn,
    kassaOut: totalOut,
    customerDebt: totalDebt,
  } = GoldEngine.calculateFinancialSummary(sales, orders);

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">
          Sotuv, Kassa va Qarzlar (Vitrina bilan bog&apos;langan)
        </h1>
        <div className="flex gap-3 text-xs">
          <div className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl">
            Kassa Balans:{" "}
            <b className="text-emerald-900 text-sm">{(totalIn - totalOut).toLocaleString()} so&apos;m</b>
          </div>
          <div className="bg-red-50 border border-red-200 px-4 py-2 rounded-xl">
            Qarzlar: <b className="text-red-900 text-sm">{totalDebt.toLocaleString()} so&apos;m</b>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={(e) => void handleSale(e)}
          className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit"
        >
          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setTxType("kirim")}
              className={`py-2 rounded-lg ${txType === "kirim" ? "bg-emerald-600 text-white" : ""}`}
            >
              ➕ Sotuv
            </button>
            <button
              type="button"
              onClick={() => setTxType("debt_repayment")}
              className={`py-2 rounded-lg ${
                txType === "debt_repayment" ? "bg-blue-600 text-white" : ""
              }`}
            >
              💳 Qarz to&apos;lovi
            </button>
            <button
              type="button"
              onClick={() => setTxType("chiqim")}
              className={`py-2 rounded-lg ${txType === "chiqim" ? "bg-red-600 text-white" : ""}`}
            >
              ➖ Xarajat
            </button>
          </div>

          {txType === "debt_repayment" ? (
            <>
              <div>
                <label className="text-xs font-bold text-blue-800">
                  Qaysi sotuv yoki buyurtma qarzi yopilmoqda? (Vitrina qoldig&apos;i yechilmaydi)
                </label>
                <select
                  value={debtTargetRef}
                  onChange={(e) => setDebtTargetRef(e.target.value)}
                  className="w-full border-2 border-blue-500 rounded-xl p-2 mt-1 bg-white font-bold text-xs"
                >
                  <option value="">-- Qarzdor sotuv / buyurtmani tanlang --</option>
                  {debtSales.map((s) => (
                    <option key={`sale-${s.id}`} value={`sale:${s.id}`}>
                      [Sotuv] {s.client_name} — {s.product_name} (Qarz:{" "}
                      {Number(s.debt_amount ?? 0).toLocaleString()} so&apos;m)
                    </option>
                  ))}
                  {debtOrders.map((o) => {
                    const ordDebt = Math.max(
                      0,
                      Number(o.total_price ?? 0) - Number(o.advance ?? 0)
                    );
                    return (
                      <option key={`ord-${o.id}`} value={`order:${o.id}`}>
                        [Buyurtma {o.order_no}] {o.client_name || o.customer_name} (Qarz:{" "}
                        {ordDebt.toLocaleString()} so&apos;m)
                      </option>
                    );
                  })}
                </select>
              </div>
              <input
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="Izoh (ixtiyoriy)"
                className="w-full border rounded-xl p-2"
              />
            </>
          ) : (
            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder={txType === "kirim" ? "Xaridor ismi" : "Xarajat sababi"}
              className="w-full border rounded-xl p-2 font-bold"
            />
          )}

          {txType === "kirim" && (
            <>
              <input
                list="p-list"
                value={prodName}
                onChange={(e) => setProdName(e.target.value)}
                placeholder="Mahsulot nomi"
                className="w-full border rounded-xl p-2"
              />
              <datalist id="p-list">
                {products.map((p, i) => (
                  <option key={i} value={p.name} />
                ))}
              </datalist>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-slate-500">Soni</label>
                  <input
                    type="number"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="w-full border rounded-xl p-2 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500">Vazn (gr)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="w-full border rounded-xl p-2 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500">Proba</label>
                  <input
                    type="number"
                    value={proba}
                    onChange={(e) => setProba(e.target.value)}
                    className="w-full border rounded-xl p-2 font-bold"
                  />
                </div>
              </div>
            </>
          )}

          <select
            value={payType}
            onChange={(e) => setPayType(e.target.value)}
            className="w-full border rounded-xl p-2 bg-white font-semibold"
          >
            <option>Naqd pul</option>
            <option>Karta (Terminal)</option>
            <option>Qarzga / Bo&apos;lib to&apos;lash</option>
          </select>

          <div className="grid grid-cols-2 gap-2">
            {txType !== "debt_repayment" && (
              <div>
                <label className="text-[11px] text-slate-500">Jami narx (TOTAL)</label>
                <input
                  type="number"
                  value={totalPrice}
                  onChange={(e) => {
                    setTotalPrice(e.target.value);
                    setPaidAmount(e.target.value);
                  }}
                  className="w-full border rounded-xl p-2 font-bold"
                />
              </div>
            )}
            <div className={txType === "debt_repayment" ? "col-span-2" : ""}>
              <label className="text-[11px] text-emerald-700 font-bold">
                {txType === "debt_repayment" ? "Qaytarilayotgan qarz summasi (SO'M)" : "To'landi (PAID)"}
              </label>
              <input
                type="number"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className="w-full border-2 border-emerald-500 rounded-xl p-2 font-bold"
              />
            </div>
          </div>

          {txType === "kirim" && (
            <div className="bg-red-50 p-2.5 rounded-xl border border-red-200 flex justify-between text-xs">
              <span className="font-bold text-red-800">Qolgan Qarz (REMAINING):</span>
              <b className="text-red-600 text-sm">{remDebt.toLocaleString()} so&apos;m</b>
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-xl"
          >
            Tasdiqlash
          </button>
        </form>

        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border">
          <h2 className="font-bold mb-3">Sotuv va Kassa Tarixi</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500 bg-slate-50 border-b">
                <th className="p-2.5">Mijoz</th>
                <th className="p-2.5">Mahsulot / Amaliyot</th>
                <th className="p-2.5">To&apos;landi / Qarz</th>
                <th className="p-2.5 text-center">Chek</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2.5 font-bold">{s.client_name}</td>
                  <td className="p-2.5">
                    {s.product_name}{" "}
                    {Number(s.weight ?? 0) > 0 ? `(${s.weight ?? 0}g / ${s.proba ?? 585})` : ""}
                  </td>
                  <td className="p-2.5">
                    <span
                      className={`font-bold ${
                        s.tx_type === "chiqim" ? "text-red-600" : "text-emerald-600"
                      }`}
                    >
                      {s.tx_type === "chiqim" ? "-" : "+"}
                      {Number(s.total_amount ?? 0).toLocaleString()} so&apos;m
                    </span>
                    {Number(s.debt_amount ?? 0) > 0 && (
                      <div className="text-xs text-red-500 font-semibold">
                        Qarz: {Number(s.debt_amount).toLocaleString()} so&apos;m
                      </div>
                    )}
                  </td>
                  <td className="p-2.5 text-center">
                    <button
                      onClick={() => setReceipt(s)}
                      className="border bg-blue-50 text-blue-700 px-2.5 py-1 rounded text-xs font-bold"
                    >
                      🧾 Chek
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {receipt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl max-w-sm w-full space-y-3 border shadow-2xl text-xs">
            <h3 className="font-black text-base text-center border-b pb-2">
              💎 JEWELRYFLOW ERP — CHEK
            </h3>
            <div className="flex justify-between">
              <span>Mijoz:</span>
              <b>{receipt.client_name}</b>
            </div>
            <div className="flex justify-between">
              <span>Mahsulot:</span>
              <b>
                {receipt.product_name} ({receipt.weight ?? 0}g)
              </b>
            </div>
            <div className="flex justify-between">
              <span>To&apos;landi:</span>
              <b className="text-emerald-700">
                {Number(receipt.total_amount ?? 0).toLocaleString()} so&apos;m
              </b>
            </div>
            <div className="flex justify-between">
              <span>Qolgan qarz:</span>
              <b className="text-red-600">
                {Number(receipt.debt_amount ?? 0).toLocaleString()} so&apos;m
              </b>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => window.print()}
                className="flex-1 bg-blue-600 text-white py-2 rounded-xl font-bold"
              >
                🖨️ Print
              </button>
              <button
                onClick={() => setReceipt(null)}
                className="flex-1 bg-slate-200 py-2 rounded-xl font-bold"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
