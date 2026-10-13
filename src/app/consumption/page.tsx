"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase,
  GoldEngine,
  RBAC,
  logErpAudit,
  generateIdempotencyKey,
  type ConsumptionRow,
  type BatchRow,
  type InventoryItemRow,
  type EmployeeRow,
} from "@/lib/erp-engine";

export default function ConsumptionPage() {
  const [list, setList] = useState<ConsumptionRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [inv, setInv] = useState<InventoryItemRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [batchNo, setBatchNo] = useState("");
  const [master, setMaster] = useState(() => RBAC.getCurrentUser().name);
  const [dept, setDept] = useState("Quyish");
  const [proba, setProba] = useState("585");
  const [given, setGiven] = useState("");
  const [returned, setReturned] = useState("");
  const [sprue, setSprue] = useState("0");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const [cRes, bRes, iRes, eRes] = await Promise.all([
      supabase.from("consumption").select("*").order("created_at", { ascending: false }),
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("inventory_items").select("*"),
      supabase.from("employees").select("*"),
    ]);
    if (cRes.data) setList(cRes.data as ConsumptionRow[]);
    if (bRes.data && bRes.data.length > 0) {
      const bList = bRes.data as BatchRow[];
      setBatches(bList);
      if (!batchNo) {
        const firstCode = bList[0]?.batch_no || bList[0]?.number;
        if (firstCode) setBatchNo(firstCode);
        if (bList[0]?.proba) setProba(String(bList[0].proba));
      }
    }
    if (iRes.data) setInv(iRes.data as InventoryItemRow[]);
    if (eRes.data) {
      const empList = eRes.data as EmployeeRow[];
      setEmployees(empList);
      if (empList.length > 0 && master === "Unverified Session") {
        const firstEmpName = empList[0]?.name || empList[0]?.full_name;
        if (firstEmpName) setMaster(firstEmpName);
      }
    }
  }, [master, batchNo]);

  useEffect(() => {
    void load();
  }, [load]);

  const gNum = parseFloat(given) || 0;
  const rNum = parseFloat(returned) || 0;
  const sNum = parseFloat(sprue) || 0;
  // Haqiqiy yo'qotish (Pateriya) = Berildi - (Mahsulot + Sprue/Qoldiq)
  const lossNum = Number((gNum - rNum - sNum).toFixed(4));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!RBAC.can("record_consumption") && !RBAC.can("move_batch")) {
      alert("Ruxsat yo'q!");
      return;
    }
    if (!batchNo.trim()) {
      alert("Partiya raqamini tanlang yoki kiriting!");
      return;
    }
    if (!given || !returned || gNum <= 0 || rNum < 0 || sNum < 0) {
      alert("Berilgan va qaytgan vaznni to'g'ri kiriting!");
      return;
    }
    if (lossNum < 0) {
      alert(
        "XATO: Qaytgan mahsulot va Sprue yig'indisi berilgan oltin vaznidan ko'p bo'lishi mumkin emas!"
      );
      return;
    }

    const pNum = parseInt(proba, 10) || 585;
    const empObj = employees.find((x) => (x.name || x.full_name) === master);

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("consumption");
      const { error } = await supabase.rpc("rpc_record_stage_consumption", {
        p_batch_no: batchNo.trim(),
        p_master_name: master,
        p_department: dept,
        p_proba: pNum,
        p_given_weight: gNum,
        p_returned_weight: rNum,
        p_sprue_gram: sNum,
        p_master_id: empObj?.id != null ? String(empObj.id) : null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik sarfiyat saqlash rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_record_stage_consumption funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "consumption",
        recordId: batchNo.trim(),
        action: "RECORD_CONSUMPTION",
        newData: { batchNo: batchNo.trim(), dept, master, gNum, rNum, sNum, lossNum },
      });
      setGiven("");
      setReturned("");
      setSprue("0");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Sprue / Qoldiqni Affinajga (Scrap/Lom inventariga) atomik qaytarish
  const sendSprueToRefinery = async (item: ConsumptionRow) => {
    if (busyRef.current || busy) return;
    if (!RBAC.can("edit_inventory") && !RBAC.can("move_batch")) {
      alert("Ruxsat yo'q!");
      return;
    }
    if (item.sent_to_refinery) {
      alert("Ushbu qoldiq allaqachon omborga qaytarilgan!");
      return;
    }
    const sp = Number(item.sprue_gram ?? 0);
    if (sp <= 0) return;
    const pr = Number(item.proba ?? 585);

    const scrapTarget = inv.find(
      (x) => (x.category === "Scrap" || x.category === "Lom") && Number(x.proba || pr) === pr
    );
    if (!scrapTarget) {
      alert(
        `Omborda ${pr} probali Lom/Scrap yozuvi topilmadi! Sprue/Qoldiqni sof oltin bilan aralashtirmaslik uchun avval Lom/Scrap yozuvini ro'yxatdan o'tkazing.`
      );
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey(`sprue-ret-${item.id || ""}`);
      const { error } = await supabase.rpc("rpc_return_sprue_to_scrap_inventory", {
        p_consumption_id: item.id,
        p_scrap_item_id: scrapTarget.id,
        p_batch_no: item.batch_no || "Partiya",
        p_sprue_weight: sp,
        p_proba: pr,
        p_pure_gold: GoldEngine.toPureGold(sp, pr),
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik sprue qaytarish tranzaksiyasi rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_return_sprue_to_scrap_inventory funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "consumption",
        recordId: String(item.id ?? ""),
        action: "RETURN_SPRUE_TO_SCRAP",
        newData: { consumptionId: item.id, scrapItemId: scrapTarget.id, sp, pr },
      });
      alert(`${sp.toFixed(2)} gr Sprue/qoldiq Omborga (Lom/Scrap hisobiga) qaytarildi!`);
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const totalGiven = list.reduce((s, x) => s + Number(x.given_weight ?? x.given ?? 0), 0);
  const totalRet = list.reduce((s, x) => s + Number(x.returned_weight ?? x.returned ?? 0), 0);
  const totalLoss = list.reduce(
    (s, x) =>
      s +
      Number(
        x.loss_weight ??
          (Number(x.given_weight ?? x.given ?? 0) -
            Number(x.returned_weight ?? x.returned ?? 0) -
            Number(x.sprue_gram ?? 0))
      ),
    0
  );

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Sarfiyat, Pateriya va Oltin Balansi
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Partiya bo&apos;yicha berilgan oltin, chiqqan mahsulot, sprue/qoldiq va yo&apos;qotishlar
            (PRD 15-band)
          </p>
        </div>
        <div className="flex gap-3 text-xs">
          <div className="bg-blue-50 border border-blue-200 px-3.5 py-2 rounded-xl">
            Berildi: <b className="text-blue-900">{totalGiven.toFixed(2)} gr</b>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 px-3.5 py-2 rounded-xl">
            Qaytdi: <b className="text-emerald-900">{totalRet.toFixed(2)} gr</b>
          </div>
          <div className="bg-red-50 border border-red-200 px-3.5 py-2 rounded-xl">
            Jami Pateriya: <b className="text-red-700">{totalLoss.toFixed(2)} gr</b>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-fit">
          <h2 className="text-lg font-bold mb-4 border-b pb-2">
            Oltin balansi va Pateriya kiritish
          </h2>
          <form onSubmit={(e) => void handleSave(e)} className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-600">Qaysi partiya?</label>
                <select
                  value={batchNo}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBatchNo(val);
                    const matched = batches.find((b) => (b.batch_no || b.number) === val);
                    if (matched?.proba) setProba(String(matched.proba));
                  }}
                  className="w-full border rounded-xl p-2.5 mt-1 bg-white font-bold"
                >
                  <option value="">-- Partiyani tanlang --</option>
                  {batches.map((b, i) => {
                    const bN = b.batch_no || b.number;
                    return bN ? (
                      <option key={i} value={bN}>
                        {bN} ({b.product_name || b.product || "Partiya"})
                      </option>
                    ) : null;
                  })}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Bo&apos;lim</label>
                <select
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  className="w-full border rounded-xl p-2.5 mt-1 bg-white font-semibold"
                >
                  <option>Quyish</option>
                  <option>Zaklirovka</option>
                  <option>Sanding</option>
                  <option>Polirovka</option>
                  <option>Lazer</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-600">Mas&apos;ul usta</label>
                <input
                  list="cons-emp-list"
                  type="text"
                  value={master}
                  onChange={(e) => setMaster(e.target.value)}
                  className="w-full border rounded-xl p-2 mt-1"
                />
                <datalist id="cons-emp-list">
                  {employees.map((em, idx) => (
                    <option key={idx} value={em.name || em.full_name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Proba</label>
                <input
                  type="number"
                  value={proba}
                  onChange={(e) => setProba(e.target.value)}
                  className="w-full border rounded-xl p-2 mt-1 font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-600">Berildi (gr)</label>
                <input
                  type="number"
                  step="0.01"
                  value={given}
                  onChange={(e) => setGiven(e.target.value)}
                  placeholder="1000"
                  className="w-full border rounded-xl p-2 mt-1 font-bold"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Mahsulot (gr)</label>
                <input
                  type="number"
                  step="0.01"
                  value={returned}
                  onChange={(e) => setReturned(e.target.value)}
                  placeholder="850"
                  className="w-full border rounded-xl p-2 mt-1 font-bold text-emerald-700"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Sprue/Qoldiq</label>
                <input
                  type="number"
                  step="0.01"
                  value={sprue}
                  onChange={(e) => setSprue(e.target.value)}
                  placeholder="70"
                  className="w-full border rounded-xl p-2 mt-1 font-bold text-amber-700"
                />
              </div>
            </div>

            <div className="bg-red-50 p-3 rounded-xl border border-red-200 flex justify-between items-center text-xs">
              <span className="text-red-800 font-semibold">
                Hisoblangan Pateriya (Yo&apos;qotish):
              </span>
              <b className="text-red-600 text-base">{lossNum.toFixed(2)} gr</b>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-xl shadow"
            >
              Hisobotni saqlash
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold mb-4">Pateriya, Sprue va Oltin harakati tarixi</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                <th className="p-3">Partiya / Bo&apos;lim</th>
                <th className="p-3">Usta</th>
                <th className="p-3">Berildi</th>
                <th className="p-3">Mahsulot / Sprue</th>
                <th className="p-3">Pateriya</th>
                <th className="p-3 text-center">Qoldiq harakati</th>
              </tr>
            </thead>
            <tbody>
              {list.map((it, i) => {
                const g = Number(it.given_weight ?? it.given ?? 0);
                const r = Number(it.returned_weight ?? it.returned ?? 0);
                const sp = Number(it.sprue_gram ?? 0);
                const l = Number(it.loss_weight ?? g - r - sp);
                return (
                  <tr key={i} className="border-b hover:bg-slate-50">
                    <td className="p-3">
                      <b className="text-slate-900">{it.batch_no || it.batch || "B-0010"}</b>
                      <div className="text-xs text-slate-400">
                        {it.department || "Quyish"} ({it.proba ?? 585})
                      </div>
                    </td>
                    <td className="p-3 text-slate-700">{it.master_name || it.master || "-"}</td>
                    <td className="p-3 font-semibold">{g.toFixed(2)} gr</td>
                    <td className="p-3">
                      <span className="font-bold text-emerald-600">{r.toFixed(2)} gr</span>
                      {sp > 0 && (
                        <div className="text-xs text-amber-600 font-semibold">
                          Sprue: {sp.toFixed(2)} gr
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-extrabold text-red-600">{l.toFixed(2)} gr</td>
                    <td className="p-3 text-center">
                      {sp > 0 ? (
                        it.sent_to_refinery ? (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-bold">
                            ✓ Omborda
                          </span>
                        ) : (
                          <button
                            onClick={() => void sendSprueToRefinery(it)}
                            disabled={busy}
                            className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-2.5 py-1 rounded-lg"
                          >
                            ♻️ Affinajga
                          </button>
                        )
                      ) : (
                        <span className="text-xs text-slate-300">-</span>
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