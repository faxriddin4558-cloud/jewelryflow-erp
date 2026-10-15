"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase,
  GoldEngine,
  RBAC,
  logErpAudit,
  generateIdempotencyKey,
  type BatchRow,
  type ProductionStageRow,
  type BatchStageWipRow,
  type MachineRow,
  type InventoryItemRow,
  type EmployeeRow,
} from "@/lib/erp-engine";
import {
  getNextActiveStage,
  isStageActive,
} from "@/lib/factory-config";

export default function BatchesPage() {
  const [tab, setTab] = useState<"wip" | "queue" | "machines" | "tv">("wip");
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [stages, setStages] = useState<ProductionStageRow[]>([]);
  const [wipRows, setWipRows] = useState<BatchStageWipRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [inv, setInv] = useState<InventoryItemRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [sel, setSel] = useState<BatchRow | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const [bNo, setBNo] = useState("");
  const [prod, setProd] = useState("");
  const [proba, setProba] = useState("585");
  const [pQty, setPQty] = useState("10");
  const [pGram, setPGram] = useState("150");
  const [prio, setPrio] = useState("Normal");
  const [dl, setDl] = useState("");

  const [fromSt, setFromSt] = useState<number>(8);
  const [mQty, setMQty] = useState("4");
  const [mGram, setMGram] = useState("60");
  const [spG, setSpG] = useState("0");
  const [scG, setScG] = useState("0");
  const [lsG, setLsG] = useState("0");
  const [rwQ, setRwQ] = useState("0");
  const [worker, setWorker] = useState(() => RBAC.getCurrentUser().name);
  const [splitQ, setSplitQ] = useState("3");

  const load = useCallback(async () => {
    const [b, s, w, m, i, e] = await Promise.all([
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("production_stages").select("*").order("stage_order"),
      supabase.from("batch_stage_wip").select("*").order("stage_order"),
      supabase.from("machines").select("*").order("name"),
      supabase.from("inventory_items").select("*"),
      supabase.from("employees").select("*"),
    ]);
    if (b.data) setBatches(b.data as BatchRow[]);
    if (s.data) setStages(s.data as ProductionStageRow[]);
    if (w.data) setWipRows(w.data as BatchStageWipRow[]);
    if (m.data) setMachines(m.data as MachineRow[]);
    if (i.data) setInv(i.data as InventoryItemRow[]);
    if (e.data) {
      const empList = e.data as EmployeeRow[];
      setEmployees(empList);
      if (empList.length > 0 && worker === "Unverified Session") {
        const firstEmpName = empList[0]?.name || empList[0]?.full_name;
        if (firstEmpName) setWorker(firstEmpName);
      }
    }
  }, [worker]);

  useEffect(() => {
    void load();
  }, [load]);

  const isDone = (s?: string | null) =>
    s === "Tugatildi" || (s || "").toLowerCase() === "completed";

  const createBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || busy) return;
    if (!RBAC.can("create_batch")) {
      alert("Ruxsat yo'q yoki jarayon band!");
      return;
    }
    const qN = parseInt(pQty, 10) || 0;
    const gN = parseFloat(pGram) || 0;
    const prN = parseInt(proba, 10) || 585;
    const cleanBatchNo = bNo.trim();
    const cleanProd = prod.trim();
    if (!cleanBatchNo || !cleanProd || qN <= 0 || gN <= 0) {
      alert("Ma'lumotlarni to'g'ri kiriting!");
      return;
    }
    if (batches.some((b) => (b.batch_no || b.number) === cleanBatchNo)) {
      alert(`Partiya raqami (${cleanBatchNo}) allaqachon mavjud!`);
      return;
    }

    const sourceGold = inv.find((x) => x.category === "Gold" && Number(x.proba) === prN);
    if (!sourceGold) {
      alert(
        `SAFE omborida ${prN} probali oltin yozuvi topilmadi! Manba inventarsiz partiya ochish taqiqlangan.`
      );
      return;
    }
    const availGold = Number(sourceGold.on_hand || 0) - Number(sourceGold.reserved || 0);
    if (availGold < gN) {
      alert(
        `SAFE omborida yetarli ${prN} probali oltin yo'q! Mavjud: ${availGold.toFixed(2)} gr, Talab: ${gN.toFixed(2)} gr.`
      );
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("batch-create");
      const { error } = await supabase.rpc("rpc_create_batch_with_gold_issue", {
        p_source_item_id: sourceGold.id,
        p_batch_no: cleanBatchNo,
        p_product_name: cleanProd,
        p_master_name: worker,
        p_proba: prN,
        p_planned_qty: qN,
        p_issued_gold_gram: gN,
        p_pure_gold: GoldEngine.toPureGold(gN, prN),
        p_priority: prio,
        p_deadline: dl || null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik partiya ochish rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_create_batch_with_gold_issue funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "batches",
        recordId: cleanBatchNo,
        action: "CREATE_BATCH",
        newData: {
          batch_no: cleanBatchNo,
          product_name: cleanProd,
          source_item_id: sourceGold.id,
          proba: prN,
          planned_qty: qN,
          issued_gold_gram: gN,
        },
      });
      setBNo("");
      setProd("");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // 6-BAND: QUANTITY-BASED PARTIAL WIP (Atomik RPC orqali — Stage 25 da Vitrina stock +1 marta kirim bo'ladi)
  const movePartialWip = async (b: BatchRow) => {
    if (busyRef.current || busy) return;
    if (!RBAC.can("move_batch")) {
      alert("Ruxsat yo'q!");
      return;
    }
    const qMove = parseInt(mQty, 10) || 0;
    const gMove = parseFloat(mGram) || 0;
    const qRew = parseInt(rwQ, 10) || 0;
    const gSprue = parseFloat(spG) || 0;
    const gScrap = parseFloat(scG) || 0;
    const gLoss = parseFloat(lsG) || 0;

    if (qMove < 0 || gMove < 0 || qRew < 0 || gSprue < 0 || gScrap < 0 || gLoss < 0) {
      alert("Manfiy qiymat kiritish mumkin emas!");
      return;
    }
    if (qMove <= 0 && qRew <= 0) {
      alert("Miqdor 0 bo'lishi mumkin emas!");
      return;
    }

    const bCode = b.batch_no || b.number || "";
    const curWip = wipRows.find((w) => w.batch_no === bCode && w.stage_order === fromSt);
    if (!curWip) {
      alert(`Tanlangan bosqichda (${fromSt}) aktiv WIP yozuvi topilmadi!`);
      return;
    }
    const avail = Number(curWip.available_qty ?? 0);
    if (qMove + qRew > avail) {
      alert(`XATO: Bu bosqichda faqat ${avail} dona mavjud!`);
      return;
    }

    const nextSt = getNextActiveStage(fromSt, stages);
    const rem = avail - qMove - qRew;

    const nSprue = Number((Number(b.sprue_gram ?? 0) + gSprue).toFixed(4));
    const nScrap = Number((Number(b.scrap_gram ?? 0) + gScrap).toFixed(4));
    const nLoss = Number((Number(b.loss_gram ?? 0) + gLoss).toFixed(4));
    const isFinal = nextSt.stage_order >= 25;
    const nGoodG = Number(
      (
        isFinal ? Number(b.good_output_gram ?? 0) + gMove : Number(b.good_output_gram ?? 0)
      ).toFixed(4)
    );
    const inG = Number(b.issued_gold_gram ?? b.planned_gram ?? 0);
    const totalOutAndLosses = Number((nGoodG + nSprue + nScrap + nLoss).toFixed(4));
    if (inG <= 0 || totalOutAndLosses > inG + 0.05) {
      alert(
        `Mass Balance xatosi: Chiqish + Sprue + Scrap + Loss (${totalOutAndLosses.toFixed(2)}g) partiyaga berilgan oltindan (${inG.toFixed(2)}g) oshib ketdi!`
      );
      return;
    }

    if (gLoss > 0) {
      const curStageObj = stages.find((s) => s.stage_order === fromSt);
      const lossCheck = GoldEngine.validateStageLoss({
        inputWeightGram: gMove + gLoss + gSprue + gScrap,
        lossWeightGram: gLoss,
        stageName: curStageObj?.name,
      });
      if (!lossCheck.isAcceptable) {
        const confirmLoss = window.confirm(
          `DIQQAT: Ushbu bosqichda yo'qotish me'yordan oshdi!\n` +
          `Kiritilgan pateriya: ${gLoss.toFixed(2)}g (${lossCheck.lossPct.toFixed(2)}%)\n` +
          `Ruxsat etilgan me'yor: ${lossCheck.maxLossPct}% (maks ${lossCheck.maxLossGram}g)\n` +
          `Ortiqcha yo'qotish: +${lossCheck.excessLossGram.toFixed(2)}g.\n\n` +
          `Ushbu holat audit jurnalida qayd etiladi. Davom ettirishni tasdiqlaysizmi?`
        );
        if (!confirmLoss) {
          return;
        }
      }
    }

    const empObj = employees.find((e) => (e.name || e.full_name) === worker);

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("wip-move");
      const { error } = await supabase.rpc("rpc_move_partial_wip", {
        p_batch_id: b.id != null ? String(b.id) : null,
        p_from_stage_order: fromSt,
        p_to_stage_order: nextSt.stage_order,
        p_to_stage_name: nextSt.name,
        p_to_department: nextSt.department || "Sex",
        p_move_qty: qMove,
        p_move_weight: gMove,
        p_move_gram: gMove,
        p_rework_qty: qRew,
        p_sprue_gram: gSprue,
        p_scrap_gram: gScrap,
        p_loss_gram: gLoss,
        p_worker_name: worker,
        p_worker_id: empObj?.id != null ? String(empObj.id) : null,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik WIP ko'chirish rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_move_partial_wip funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "batch_stage_wip",
        recordId: bCode,
        action: "PARTIAL_MOVE",
        newData: { fromSt, to: nextSt.name, qMove, gMove, worker },
      });
      alert(
        `${qMove} komplekt (${gMove}g) "${nextSt.name}" ga atomik o'tkazildi! Joriy bo'limda ${rem} komplekt qoldi.`
      );
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const splitBatch = async (b: BatchRow) => {
    if (busyRef.current || busy) return;
    if (!RBAC.can("split_batch") && !RBAC.can("move_batch")) {
      alert("Ruxsat yo'q!");
      return;
    }
    const sQ = parseInt(splitQ, 10) || 0;
    const totQ = Number(b.planned_qty ?? 0);
    const totG = Number(b.issued_gold_gram ?? b.planned_gram ?? 0);
    if (sQ <= 0 || sQ >= totQ || totG <= 0) {
      alert("Bo'linadigan son yoki partiya og'irligi noto'g'ri!");
      return;
    }

    const baseNo = b.batch_no || b.number || "BATCH";
    let splitIdx = 1;
    while (batches.some((x) => (x.batch_no || x.number) === `${baseNo}-S${splitIdx}`)) {
      splitIdx += 1;
    }
    const child = `${baseNo}-S${splitIdx}`;

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("split-batch");
      const { error } = await supabase.rpc("rpc_split_batch", {
        p_parent_batch_id: b.id != null ? String(b.id) : null,
        p_split_qty: sQ,
        p_child_batch_no: child,
        p_stage_order: fromSt,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik partiya bo'lish rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_split_batch funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "batches",
        recordId: child,
        action: "SPLIT_BATCH",
        newData: { parent: baseNo, child, sQ },
      });
      alert(`Partiya atomik bo'lindi: ${child} (${sQ} dona)`);
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const deptQueues = [
    "Quyish",
    "Zaklirovka",
    "Sanding",
    "Ponza",
    "Polirovka",
    "Tosh qo'yish",
    "Lazer",
    "Moyka",
    "QC",
  ]
    .filter((d) => isStageActive({ department: d, name: d }))
    .map((d) => {
      const list = wipRows.filter((w) => w.department === d && Number(w.available_qty ?? 0) > 0);
      const pcs = list.reduce((s, w) => s + Number(w.available_qty ?? 0), 0);
      const cap = d === "Lazer" || d === "Tosh qo'yish" ? 200 : 300;
      return { dept: d, pcs, cap, backlog: Math.max(0, pcs - cap), list };
    });

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">
          Partiya Engine, Quantity-WIP (4/10 → 3/4) &amp; Mass Balance
        </h1>
        <div className="flex gap-1.5 bg-slate-100 p-1.5 rounded-xl border">
          <button
            onClick={() => setTab("wip")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "wip" ? "bg-purple-600 text-white" : "text-slate-600"
            }`}
          >
            ⚙️ Partiyalar &amp; WIP ({batches.length})
          </button>
          <button
            onClick={() => setTab("queue")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "queue" ? "bg-purple-600 text-white" : "text-slate-600"
            }`}
          >
            🚦 Queue &amp; Bottleneck
          </button>
          <button
            onClick={() => setTab("machines")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "machines" ? "bg-purple-600 text-white" : "text-slate-600"
            }`}
          >
            🔬 Apparatlar ({machines.length})
          </button>
          <button
            onClick={() => setTab("tv")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === "tv" ? "bg-purple-600 text-white" : "text-slate-600"
            }`}
          >
            📺 TV Monitor
          </button>
        </div>
      </div>

      {tab === "wip" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={(e) => void createBatch(e)}
            className="bg-white p-5 rounded-2xl border space-y-3 text-sm h-fit"
          >
            <h2 className="font-bold border-b pb-2">➕ Yangi Partiya (SAFE → CASTING)</h2>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={bNo}
                onChange={(e) => setBNo(e.target.value)}
                placeholder="Batch ID (B-0012)"
                className="border rounded-xl p-2 font-bold"
              />
              <input
                type="number"
                value={proba}
                onChange={(e) => setProba(e.target.value)}
                placeholder="Proba"
                className="border rounded-xl p-2 font-bold"
              />
            </div>
            <input
              value={prod}
              onChange={(e) => setProd(e.target.value)}
              placeholder="Model / Komplekt nomi"
              className="w-full border rounded-xl p-2"
            />
            <div>
              <label className="text-xs text-slate-500">Mas&apos;ul usta</label>
              <input
                list="batch-worker-list"
                value={worker}
                onChange={(e) => setWorker(e.target.value)}
                placeholder="Mas'ul usta ismi"
                className="w-full border rounded-xl p-2 font-bold mt-1"
              />
              <datalist id="batch-worker-list">
                {employees.map((em, idx) => (
                  <option key={idx} value={em.name || em.full_name} />
                ))}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500">Reja Soni (komplekt)</label>
                <input
                  type="number"
                  value={pQty}
                  onChange={(e) => setPQty(e.target.value)}
                  className="w-full border rounded-xl p-2 font-bold"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Berilgan Oltin (gr)</label>
                <input
                  type="number"
                  value={pGram}
                  onChange={(e) => setPGram(e.target.value)}
                  className="w-full border rounded-xl p-2 font-bold text-amber-700"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={prio}
                onChange={(e) => setPrio(e.target.value)}
                className="border rounded-xl p-2 bg-white font-bold"
              >
                <option>Normal</option>
                <option>VIP</option>
                <option>URGENT</option>
              </select>
              <input
                type="date"
                value={dl}
                onChange={(e) => setDl(e.target.value)}
                className="border rounded-xl p-2"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-purple-600 text-white font-bold py-2.5 rounded-xl"
            >
              Partiya ochish
            </button>
          </form>

          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white p-5 rounded-2xl border overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 bg-slate-50 border-b">
                    <th className="p-2">ID</th>
                    <th className="p-2">Model</th>
                    <th className="p-2">Tayyor/Reja</th>
                    <th className="p-2">Input / WIP</th>
                    <th className="p-2">Mass Balance</th>
                    <th className="p-2">Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b, i) => {
                    const d = isDone(b.status);
                    const inG = Number(b.issued_gold_gram ?? b.planned_gram ?? 0);
                    const goodG = Number(b.good_output_gram ?? (d ? b.actual_gram ?? 0 : 0));
                    const sprueG = Number(b.sprue_gram ?? 0);
                    const scrapG = Number(b.scrap_gram ?? 0);
                    const reworkG = Number(b.rework_gram ?? 0);
                    const lsG = Number(b.loss_gram ?? 0);
                    const wipG = d
                      ? 0
                      : Number(
                          b.wip_gram ?? Math.max(0, inG - goodG - sprueG - scrapG - reworkG - lsG)
                        );
                    const mb = GoldEngine.verifyMassBalance({
                      inputGold: inG,
                      goodProduct: goodG,
                      sprue: sprueG,
                      scrap: scrapG,
                      rework: reworkG,
                      loss: lsG,
                      remainingWip: wipG,
                    });
                    return (
                      <tr
                        key={i}
                        onClick={() => setSel(b)}
                        className={`border-b cursor-pointer ${
                          sel?.id === b.id ? "bg-purple-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="p-2 font-bold">{b.batch_no || b.number}</td>
                        <td className="p-2">{b.product_name || b.product}</td>
                        <td className="p-2 font-bold text-blue-700">
                          {b.finished_qty ?? 0}/{b.planned_qty ?? 0}
                        </td>
                        <td className="p-2">
                          {inG}g / <b>{wipG}g</b>
                        </td>
                        <td className="p-2 text-xs font-bold">
                          <span className={mb.isBalanced ? "text-emerald-600" : "text-red-600"}>
                            {mb.statusText}
                          </span>
                        </td>
                        <td className="p-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                              d ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {d ? "Tugatildi" : "Jarayonda"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {sel && (
              <div className="bg-white p-5 rounded-2xl border-2 border-purple-600 space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="font-bold text-lg">
                    {sel.batch_no || sel.number} — Bo&apos;lib-bo&apos;lib o&apos;tkazish (Partial
                    Quantity WIP)
                  </h3>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={splitQ}
                      onChange={(e) => setSplitQ(e.target.value)}
                      className="w-14 border rounded p-1 text-xs font-bold"
                    />
                    <button
                      onClick={() => void splitBatch(sel)}
                      disabled={busy}
                      className="bg-slate-800 text-white text-xs px-2.5 py-1 rounded"
                    >
                      ✂️ Split
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {wipRows
                    .filter((w) => w.batch_no === (sel.batch_no || sel.number))
                    .map((w, idx) => (
                      <div
                        key={idx}
                        onClick={() => setFromSt(w.stage_order)}
                        className={`p-2.5 rounded-xl border text-xs cursor-pointer ${
                          fromSt === w.stage_order
                            ? "border-blue-600 bg-blue-50"
                            : "bg-slate-50"
                        }`}
                      >
                        <b>{w.stage_name}</b>
                        <div className="text-blue-700 font-black mt-1">
                          Mavjud: {w.available_qty} | Tayyor: {w.completed_qty}
                        </div>
                      </div>
                    ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl border text-xs">
                  <div>
                    <label className="font-bold">Qaysi bosqichdan?</label>
                    <select
                      value={fromSt}
                      onChange={(e) => setFromSt(Number(e.target.value))}
                      className="w-full border rounded p-1.5 bg-white mt-1"
                    >
                      {stages.map((s) => {
                        const active = isStageActive(s);
                        return (
                          <option key={s.stage_order} value={s.stage_order}>
                            {s.name} {!active ? "(O'chirilgan / Bypassed)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-emerald-700">Tayyor (Qty dona)</label>
                    <input
                      type="number"
                      value={mQty}
                      onChange={(e) => setMQty(e.target.value)}
                      className="w-full border rounded p-1.5 bg-white mt-1 font-bold"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-emerald-700">Vazni (gr)</label>
                    <input
                      type="number"
                      value={mGram}
                      onChange={(e) => setMGram(e.target.value)}
                      className="w-full border rounded p-1.5 bg-white mt-1 font-bold"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-amber-700">Sprue / Qoldiq (gr)</label>
                    <input
                      type="number"
                      value={spG}
                      onChange={(e) => setSpG(e.target.value)}
                      className="w-full border rounded p-1.5 bg-white mt-1"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-red-600">Scrap / Brak (gr)</label>
                    <input
                      type="number"
                      value={scG}
                      onChange={(e) => setScG(e.target.value)}
                      className="w-full border rounded p-1.5 bg-white mt-1"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-red-700">Pateriya / Loss (gr)</label>
                    <input
                      type="number"
                      value={lsG}
                      onChange={(e) => setLsG(e.target.value)}
                      className="w-full border rounded p-1.5 bg-white mt-1"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-amber-700">QC Rework (dona)</label>
                    <input
                      type="number"
                      value={rwQ}
                      onChange={(e) => setRwQ(e.target.value)}
                      className="w-full border rounded p-1.5 bg-white mt-1"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() => void movePartialWip(sel)}
                      disabled={busy}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-2 rounded-lg text-xs transition-colors"
                    >
                      ✓ {mQty} dona → {getNextActiveStage(fromSt, stages).name}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "queue" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {deptQueues.map((q, i) => (
            <div key={i} className="bg-white p-4 rounded-2xl border space-y-2">
              <div className="flex justify-between items-center border-b pb-2">
                <div>
                  <b>{q.dept}</b>
                  <div className="text-[11px] text-slate-400">Capacity: {q.cap} pcs/day</div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    q.backlog > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  Queue: {q.pcs} pcs
                </span>
              </div>
              {q.list.map((it, j) => (
                <div
                  key={j}
                  className="text-xs bg-slate-50 p-2 rounded border flex justify-between"
                >
                  <b>
                    {it.batch_no} ({it.queue_status})
                  </b>
                  <b>
                    {it.available_qty} dona ({it.input_weight}g)
                  </b>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "machines" && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {machines.map((m) => (
            <div key={m.id} className="bg-white p-4 rounded-2xl border space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-400">{m.department}</span>
                <span className="text-blue-600">{(m.status || "ACTIVE").toUpperCase()}</span>
              </div>
              <div className="font-bold">{m.name}</div>
              <div className="text-xs text-slate-500">
                Capacity: {m.daily_capacity ?? 0} pcs/day
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "tv" && (
        <div className="bg-slate-950 p-6 rounded-2xl text-white">
          <h2 className="text-xl font-black mb-4">📺 SHOPFLOOR LIVE TV MONITOR</h2>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs">
                <th className="p-2">BATCH</th>
                <th className="p-2">PRIORITY</th>
                <th className="p-2">MODEL</th>
                <th className="p-2">STAGE</th>
                <th className="p-2">QTY</th>
                <th className="p-2 text-right">MASSA</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={i} className="border-b border-slate-900 font-bold text-lg">
                  <td className="p-2 text-amber-400">{b.batch_no || b.number}</td>
                  <td className="p-2 text-xs">{b.priority || "NORMAL"}</td>
                  <td className="p-2">{b.product_name || b.product}</td>
                  <td className="p-2 text-blue-400">
                    {isDone(b.status) ? "25. Tayyor ombor" : b.current_step || "8. Quyish"}
                  </td>
                  <td className="p-2 text-emerald-400">
                    {b.finished_qty ?? 0}/{b.planned_qty ?? 0}
                  </td>
                  <td className="p-2 text-right">{b.issued_gold_gram ?? b.planned_gram ?? 0} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}