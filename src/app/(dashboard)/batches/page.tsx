"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

const ALL_OPERATIONS = [
  "1. Model / dizayn",
  "2. Rezina / mum / vosk",
  "3. Vosk bilan ishlash",
  "4. Payka / vosk daraxti",
  "5. Gipslash / investment",
  "6. Burnout / pech",
  "7. Quyish",
  "8. Zaklirovka",
  "9. Rigel bilan to'g'rilash",
  "10. Sanding / shlifovka",
  "11. Ponza / galtovka",
  "12. Igna bilan tozalash",
  "13. Chotka / yarim polirovka",
  "14. Tozalash (1)",
  "15. Zircon",
  "16. Tozalash (2)",
  "17. Yakuniy polirovka",
  "18. Lazer / dorika / payka",
  "19. Tezkor qo'l polirovkasi",
  "20. Moyka",
  "21. Yig'ish",
  "22. Yakuniy sanash",
  "23. QC / sifat nazorati",
  "24. Tayyor mahsulot ombori",
  "25. Sotuv / topshirish"
];

const DELAY_REASONS = [
  "Oltin yetishmadi",
  "Xomashyo yetishmadi",
  "Apparat nosoz",
  "Ishchi yetishmadi",
  "Lazer band",
  "QC / Rework (Qayta ishlash)",
  "Mijoz o'zgartirish so'radi"
];

export default function BatchesPage() {
  const [activeTab, setActiveTab] = useState<"list" | "queue" | "machines" | "tv">("list");
  const [batches, setBatches] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [qcLogs, setQcLogs] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Yangi partiya formasi
  const [batchNo, setBatchNo] = useState("");
  const [productName, setProductName] = useState("");
  const [masterName, setMasterName] = useState("Valijon");
  const [status, setStatus] = useState("Jarayonda");
  const [proba, setProba] = useState("585");
  const [plannedQty, setPlannedQty] = useState("10");
  const [plannedGram, setPlannedGram] = useState("500");
  const [deadline, setDeadline] = useState("");
  const [modelsInput, setModelsInput] = useState("Uzuk x10, Zirak x10, Kulon x10");
  const [skipPonzaZircon, setSkipPonzaZircon] = useState(false);

  // Operatsiya va QC formasi (Tanlangan partiya uchun)
  const [opGram, setOpGram] = useState("");
  const [opQty, setOpQty] = useState("");
  const [reworkQty, setReworkQty] = useState("0");
  const [defectReason, setDefectReason] = useState("Chiziq / dog'");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [delayReason, setDelayReason] = useState("");

  const fetchAllData = async () => {
    const { data: bData } = await supabase.from("batches").select("*").order("created_at", { ascending: false });
    if (bData) setBatches(bData);

    const { data: eData } = await supabase.from("employees").select("*");
    if (eData && eData.length > 0) setEmployees(eData);

    const { data: mData } = await supabase.from("machines").select("*").order("name");
    if (mData) setMachines(mData);

    const { data: qData } = await supabase.from("quality_control").select("*").order("created_at", { ascending: false });
    if (qData) setQcLogs(qData);
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Yangi partiya yaratish
  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchNo || !productName) return alert("Partiya raqami va mahsulotni kiriting!");
    setIsLoading(true);

    const route = skipPonzaZircon
      ? ALL_OPERATIONS.filter((op) => !op.includes("Ponza") && !op.includes("Zircon"))
      : ALL_OPERATIONS;

    const parsedModels = modelsInput.split(",").map((m) => ({
      name: m.trim(),
      stage: route[0],
      status: "Jarayonda"
    }));

    const { error } = await supabase.from("batches").insert([
      {
        batch_no: batchNo,
        product_name: productName,
        master_name: masterName,
        status: status,
        proba: parseInt(proba) || 585,
        planned_qty: parseInt(plannedQty) || 10,
        planned_gram: parseFloat(plannedGram) || 0,
        actual_qty: parseInt(plannedQty) || 10,
        actual_gram: parseFloat(plannedGram) || 0,
        current_step: "7. Quyish",
        deadline: deadline || null,
        route_steps: route,
        models_data: parsedModels
      }
    ]);

    setIsLoading(false);
    if (error) {
      alert("Xatolik: " + error.message);
    } else {
      setBatchNo("");
      setProductName("");
      fetchAllData();
    }
  };

  // Bosqichni yakunlab keyingi bo'limga o'tkazish + QC yozish
  const handleAdvanceStep = async (batch: any) => {
    const route: string[] = batch.route_steps?.length > 0 ? batch.route_steps : ALL_OPERATIONS;
    const currentIndex = route.indexOf(batch.current_step || "7. Quyish");
    const nextStep = currentIndex >= 0 && currentIndex < route.length - 1 ? route[currentIndex + 1] : "24. Tayyor mahsulot ombori";
    const isFinished = nextStep.includes("Tayyor") || nextStep.includes("Sotuv");

    const newGram = opGram ? parseFloat(opGram) : Number(batch.actual_gram || batch.planned_gram || 0);
    const newQty = opQty ? parseInt(opQty) : Number(batch.actual_qty || batch.planned_qty || 0);
    const rwQty = parseInt(reworkQty) || 0;

    // 1. Agar brak/rework bo'lsa QC jadvaliga yozish
    if (rwQty > 0) {
      await supabase.from("quality_control").insert([
        {
          batch_no: batch.batch_no || batch.number,
          operation_name: batch.current_step || "Jarayon",
          checked_qty: newQty,
          passed_qty: Math.max(0, newQty - rwQty),
          rework_qty: rwQty,
          reason: defectReason,
          inspector: masterName
        }
      ]);
    }

    // 2. Apparat tanlangan bo'lsa, uni band qilish
    if (selectedMachine) {
      await supabase
        .from("machines")
        .update({ status: "band", current_batch: batch.batch_no || batch.number })
        .eq("id", selectedMachine);
    }

    // 3. Partiyani keyingi bosqichga o'tkazish
    const { error } = await supabase
      .from("batches")
      .update({
        current_step: nextStep,
        actual_gram: newGram,
        actual_qty: newQty,
        status: isFinished ? "Tugatildi" : "Jarayonda",
        delay_reason: delayReason || batch.delay_reason
      })
      .eq("id", batch.id);

    if (error) {
      alert("Xatolik: " + error.message);
    } else {
      setOpGram("");
      setOpQty("");
      setReworkQty("0");
      fetchAllData();
      setSelectedBatch({ ...batch, current_step: nextStep, actual_gram: newGram, actual_qty: newQty, status: isFinished ? "Tugatildi" : "Jarayonda" });
    }
  };

  // Apparat holatini o'zgartirish
  const toggleMachineStatus = async (machine: any) => {
    const nextStatus = machine.status === "bo'sh" ? "band" : machine.status === "band" ? "ta'mirda" : "bo'sh";
    await supabase
      .from("machines")
      .update({ status: nextStatus, current_batch: nextStatus === "bo'sh" ? null : machine.current_batch })
      .eq("id", machine.id);
    fetchAllData();
  };

  // Bo'limlar bo'yicha navbat (Queue) va Bottleneck hisobi
  const queueStats = ALL_OPERATIONS.slice(6, 23).map((step) => {
    const activeInStep = batches.filter((b) => (b.current_step || "7. Quyish") === step && b.status !== "Tugatildi");
    const totalGram = activeInStep.reduce((sum, b) => sum + Number(b.actual_gram || b.planned_gram || 0), 0);
    return { step, count: activeInStep.length, totalGram, batches: activeInStep };
  });

  const bottleneck = [...queueStats].sort((a, b) => b.totalGram - a.totalGram)[0];

  return (
    <div className="p-4 md:p-8 text-gray-100">
      {/* YUQORI SARLAVHA VA TABLAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Ishlab chiqarish (Partiyalar & ERP Flow)</h1>
          <p className="text-xs text-gray-400 mt-1">25 bosqichli texnologik yo'l, navbatlar, apparatlar va QC nazorati</p>
        </div>
        <div className="flex flex-wrap gap-2 bg-[#1e212b] p-1.5 rounded-xl border border-gray-800">
          <button onClick={() => setActiveTab("list")} className={`px-3 py-2 rounded-lg text-xs font-bold transition ${activeTab === "list" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}>
            ⚙️ Partiyalar ({batches.length})
          </button>
          <button onClick={() => setActiveTab("queue")} className={`px-3 py-2 rounded-lg text-xs font-bold transition ${activeTab === "queue" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}>
            🚦 Navbat & Bottleneck
          </button>
          <button onClick={() => setActiveTab("machines")} className={`px-3 py-2 rounded-lg text-xs font-bold transition ${activeTab === "machines" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}>
            🔬 Apparatlar ({machines.length})
          </button>
          <button onClick={() => setActiveTab("tv")} className={`px-3 py-2 rounded-lg text-xs font-bold transition ${activeTab === "tv" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}>
            📺 TV Monitor
          </button>
        </div>
      </div>

      {/* 1-TAB: PARTIYALAR RO'YXATI VA DETAIL OYNA */}
      {activeTab === "list" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* CHAP TOMON: Yangi partiya ochish */}
          <div className="bg-[#1e212b] p-6 rounded-2xl shadow-lg border border-gray-800 h-fit">
            <h2 className="text-lg font-semibold mb-4 text-gray-200">Yangi partiya ochish</h2>
            <form onSubmit={handleCreateBatch} className="space-y-3.5 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Partiya raqami</label>
                  <input type="text" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="MASALAN: B-0011" className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Proba</label>
                  <input type="number" value={proba} onChange={(e) => setProba(e.target.value)} className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Nima yasaladi? (Komplekt / Mahsulot)</label>
                <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Masalan: Komplekt (15 model)" className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white outline-none" />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Komplekt ichidagi modellar (vergul bilan)</label>
                <input type="text" value={modelsInput} onChange={(e) => setModelsInput(e.target.value)} className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2 text-xs text-gray-300 outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Reja vazn (gr)</label>
                  <input type="number" step="0.01" value={plannedGram} onChange={(e) => setPlannedGram(e.target.value)} className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Reja soni (dona)</label>
                  <input type="number" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Mas'ul usta / Supervisor</label>
                  <select value={masterName} onChange={(e) => setMasterName(e.target.value)} className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white outline-none">
                    <option value="Valijon">Valijon</option>
                    {employees.map((emp, i) => (
                      <option key={i} value={emp.name || emp.full_name}>{emp.name || emp.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Topshirish muddati</label>
                  <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full bg-[#171923] border border-gray-700 rounded-lg p-2.5 text-white outline-none" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-400 pt-1 cursor-pointer">
                <input type="checkbox" checked={skipPonzaZircon} onChange={(e) => setSkipPonzaZircon(e.target.checked)} className="rounded bg-gray-800 border-gray-600" />
                Braslet/Sepochka marshruti (Ponza va Zircon o'tkazib yuborilsin)
              </label>

              <button type="submit" disabled={isLoading} className="w-full mt-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-purple-600/20">
                {isLoading ? "Saqlanmoqda..." : "Partiyani boshlash"}
              </button>
            </form>
          </div>

          {/* O'NG TOMON: Partiyalar jadvali va Tanlangan Partiya pasporti */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-[#1e212b] p-6 rounded-2xl shadow-lg border border-gray-800">
              <h2 className="text-lg font-semibold mb-4 text-gray-200">Jarayondagi va Tugatilgan partiyalar (Boshqarish uchun ustiga bosing)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase border-b border-gray-700">
                      <th className="pb-3">Partiya No</th>
                      <th className="pb-3">Mahsulot</th>
                      <th className="pb-3">Joriy Bo'lim (Flow)</th>
                      <th className="pb-3 text-right">Gramm / Proba</th>
                      <th className="pb-3 text-center">Holati</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b, idx) => {
                      const bNo = b.batch_no || b.number || `B-00${idx + 1}`;
                      const prod = b.product_name || b.product || b.item || "Komplekt";
                      const isDone = b.status === "Tugatildi";
                      return (
                        <tr
                          key={b.id || idx}
                          onClick={() => setSelectedBatch(b)}
                          className={`border-b border-gray-800/60 cursor-pointer transition ${selectedBatch?.id === b.id ? "bg-purple-600/20" : "hover:bg-white/5"}`}
                        >
                          <td className="py-3.5 font-bold text-white">{bNo}</td>
                          <td className="py-3.5 text-gray-300">
                            {prod}
                            <div className="text-[11px] text-gray-500">Usta: {b.master_name || b.master || "Valijon"}</div>
                          </td>
                          <td className="py-3.5">
                            <span className="bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2.5 py-1 rounded-md text-xs font-medium">
                              {b.current_step || "7. Quyish"}
                            </span>
                          </td>
                          <td className="py-3.5 text-right font-semibold text-yellow-400">
                            {Number(b.actual_gram || b.planned_gram || 0)} gr <span className="text-xs text-gray-500">({b.proba || 585})</span>
                          </td>
                          <td className="py-3.5 text-center">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${isDone ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                              {b.status || "Jarayonda"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* PARTIYA DETAIL PASSORTI VA BOSQICH BOSHQARUVI (PRD 12, 13, 32-bandlar) */}
            {selectedBatch && (
              <div className="bg-[#1e212b] p-6 rounded-2xl shadow-xl border-2 border-purple-500/50 space-y-5">
                <div className="flex flex-wrap justify-between items-center border-b border-gray-800 pb-4">
                  <div>
                    <span className="text-xs uppercase tracking-wider text-purple-400 font-bold">Partiya Texnologik Pasporti</span>
                    <h3 className="text-xl font-bold text-white mt-0.5">
                      {selectedBatch.batch_no || selectedBatch.number} — {selectedBatch.product_name || selectedBatch.product}
                    </h3>
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    <div>Reja: <b className="text-white">{selectedBatch.planned_gram || 0} gr / {selectedBatch.planned_qty || 0} dona</b></div>
                    <div>Haqiqiy: <b className="text-emerald-400">{selectedBatch.actual_gram || 0} gr / {selectedBatch.actual_qty || 0} dona</b></div>
                  </div>
                </div>

                {/* 25 ta bosqichli Progress (Vizual Flow) */}
                <div>
                  <div className="text-xs font-semibold text-gray-400 mb-2">Texnologik yo'nalish (Route & Flow):</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedBatch.route_steps?.length > 0 ? selectedBatch.route_steps : ALL_OPERATIONS).map((step: string, i: number) => {
                      const routeArr = selectedBatch.route_steps?.length > 0 ? selectedBatch.route_steps : ALL_OPERATIONS;
                      const currIdx = routeArr.indexOf(selectedBatch.current_step || "7. Quyish");
                      const isCompleted = i < currIdx || selectedBatch.status === "Tugatildi";
                      const isCurrent = i === currIdx && selectedBatch.status !== "Tugatildi";
                      return (
                        <span
                          key={i}
                          className={`px-2 py-1 rounded text-[11px] font-medium border ${
                            isCompleted
                              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                              : isCurrent
                              ? "bg-blue-600 border-blue-400 text-white font-bold animate-pulse"
                              : "bg-[#171923] border-gray-800 text-gray-500"
                          }`}
                        >
                          {isCompleted ? "✓ " : isCurrent ? "→ " : ""}{step}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Operatsiyani yakunlash, Apparat va QC kiritish */}
                <div className="bg-[#171923] p-4 rounded-xl border border-gray-800 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="text-gray-400 block mb-1">Chiqish vazni (gr)</label>
                    <input type="number" step="0.01" value={opGram} onChange={(e) => setOpGram(e.target.value)} placeholder={String(selectedBatch.actual_gram || 500)} className="w-full bg-[#1e212b] border border-gray-700 rounded p-2 text-white" />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">Tayyor dona</label>
                    <input type="number" value={opQty} onChange={(e) => setOpQty(e.target.value)} placeholder={String(selectedBatch.actual_qty || 10)} className="w-full bg-[#1e212b] border border-gray-700 rounded p-2 text-white" />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">Apparatni biriktirish</label>
                    <select value={selectedMachine} onChange={(e) => setSelectedMachine(e.target.value)} className="w-full bg-[#1e212b] border border-gray-700 rounded p-2 text-white">
                      <option value="">-- Tanlanmagan --</option>
                      {machines.map((m) => (
                        <option key={m.id} value={m.id}>{m.name} ({m.status})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-amber-400 block mb-1">QC: Brak / Rework (dona)</label>
                    <input type="number" value={reworkQty} onChange={(e) => setReworkQty(e.target.value)} className="w-full bg-[#1e212b] border border-amber-700/50 rounded p-2 text-white" />
                  </div>
                  <div>
                    <label className="text-amber-400 block mb-1">Brak sababi (QC)</label>
                    <select value={defectReason} onChange={(e) => setDefectReason(e.target.value)} className="w-full bg-[#1e212b] border border-gray-700 rounded p-2 text-white">
                      <option>Chiziq / dog'</option>
                      <option>Teshik / chala quyilgan</option>
                      <option>Deformatsiya / sinish</option>
                      <option>Lazer naqsh xatosi</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-red-400 block mb-1">Kechikish sababi (agar bo'lsa)</label>
                    <select value={delayReason} onChange={(e) => setDelayReason(e.target.value)} className="w-full bg-[#1e212b] border border-gray-700 rounded p-2 text-white">
                      <option value="">-- Kechikish yo'q --</option>
                      {DELAY_REASONS.map((r, i) => <option key={i} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <button onClick={() => setSelectedBatch(null)} className="text-xs text-gray-400 hover:text-white">
                    Yopish
                  </button>
                  <button
                    onClick={() => handleAdvanceStep(selectedBatch)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs shadow-lg shadow-emerald-600/20 transition"
                  >
                    ✓ Bosqichni tugatish va Keyingi bo'limga yuborish →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2-TAB: NAVBAT (QUEUE) VA BOTTLENECK ANALYTICS */}
      {activeTab === "queue" && (
        <div className="space-y-6">
          {bottleneck && bottleneck.totalGram > 0 && (
            <div className="bg-red-500/10 border border-red-500/40 p-4 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase text-red-400">⚠️ Diqqat: Bottleneck (Eng ko'p yuklama yig'ilgan bo'lim)</span>
                <h3 className="text-lg font-bold text-white mt-1">{bottleneck.step} — {bottleneck.count} ta partiya ({bottleneck.totalGram} gr WIP)</h3>
              </div>
              <span className="bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg">Tezkor e'tibor kerak</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {queueStats.map((q, idx) => (
              <div key={idx} className="bg-[#1e212b] p-4 rounded-xl border border-gray-800">
                <div className="flex justify-between items-center border-b border-gray-800 pb-2 mb-3">
                  <span className="font-bold text-sm text-gray-200">{q.step}</span>
                  <span className="text-xs font-bold text-yellow-400">{q.totalGram} gr</span>
                </div>
                {q.batches.length === 0 ? (
                  <p className="text-xs text-gray-600">Navbatda partiya yo'q (Bo'lim bo'sh)</p>
                ) : (
                  <div className="space-y-2">
                    {q.batches.map((b: any, i: number) => (
                      <div key={i} className="bg-[#171923] p-2.5 rounded-lg flex justify-between items-center text-xs">
                        <div>
                          <b className="text-white">{b.batch_no || b.number}</b> — {b.product_name || b.product}
                        </div>
                        <span className="text-emerald-400 font-semibold">{b.actual_gram || b.planned_gram || 0} g</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3-TAB: APPARATLAR VA LAZERLAR BANDLIGI (PRD 6-band) */}
      {activeTab === "machines" && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {machines.map((m) => (
            <div key={m.id} className="bg-[#1e212b] p-5 rounded-2xl border border-gray-800 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start">
                  <span className="text-xs text-gray-400 font-semibold uppercase">{m.department}</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    m.status === "bo'sh" ? "bg-emerald-500/20 text-emerald-400" : m.status === "band" ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 text-red-400"
                  }`}>
                    {m.status.toUpperCase()}
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mt-2">{m.name}</h3>
                <p className="text-xs text-gray-400 mt-1">
                  Joriy partiya: <b className="text-yellow-400">{m.current_batch || "Yo'q"}</b>
                </p>
              </div>
              <button
                onClick={() => toggleMachineStatus(m)}
                className="mt-4 w-full bg-[#171923] hover:bg-gray-800 text-xs text-gray-300 py-2 rounded-lg border border-gray-700 transition"
              >
                Holatni almashtirish (Bo'sh / Band / Ta'mir)
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 4-TAB: TV MONITOR BOARD (PRD 25-band) */}
      {activeTab === "tv" && (
        <div className="bg-[#11131a] p-6 rounded-2xl border-2 border-gray-800">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-extrabold tracking-wide text-white">📺 FABRIKA PRODUCTION BOARD (JONLI EKRAN)</h2>
            <div className="flex gap-3 text-xs font-bold">
              <span className="text-emerald-400">● YASHIL = Tayyor</span>
              <span className="text-blue-400">● KO'K = Ishlanmoqda</span>
              <span className="text-red-400">● QIZIL = Kechikkan / Muammo</span>
            </div>
          </div>
          <table className="w-full text-left border-collapse text-base">
            <thead>
              <tr className="border-b-2 border-gray-800 text-gray-400 uppercase text-sm">
                <th className="py-3">PARTIYA</th>
                <th className="py-3">MAHSULOT</th>
                <th className="py-3">JORIY BO'LIM</th>
                <th className="py-3 text-right">MASSA</th>
                <th className="py-3 text-center">DEADLINE / HOLAT</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => {
                const isDelayed = b.delay_reason && b.delay_reason.length > 0;
                const isDone = b.status === "Tugatildi";
                return (
                  <tr key={i} className={`border-b border-gray-800/80 font-semibold ${isDelayed ? "bg-red-900/20 text-red-200" : isDone ? "bg-emerald-900/15 text-emerald-200" : "text-white"}`}>
                    <td className="py-4 text-xl font-black">{b.batch_no || b.number}</td>
                    <td className="py-4">{b.product_name || b.product}</td>
                    <td className="py-4 text-blue-400">{b.current_step || "7. Quyish"}</td>
                    <td className="py-4 text-right text-yellow-400">{b.actual_gram || b.planned_gram || 0} g</td>
                    <td className="py-4 text-center">
                      {isDelayed ? `⚠️ ${b.delay_reason}` : b.deadline || b.status}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}