"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  supabase,
  GoldEngine,
  RBAC,
  logErpAudit,
  generateIdempotencyKey,
  type InventoryItemRow,
  type EmployeeRow,
} from "@/lib/erp-engine";

export default function CalculatorPage() {
  const [inv, setInv] = useState<InventoryItemRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [inW, setInW] = useState("100");
  const [curP, setCurP] = useState("999");
  const [tarP, setTarP] = useState("585");
  const [ratio, setRatio] = useState(70);

  const [scrapW, setScrapW] = useState("400");
  const [estP, setEstP] = useState("585");
  const [outW, setOutW] = useState("233.50");
  const [outP, setOutP] = useState("999");
  const [master, setMaster] = useState(() => RBAC.getCurrentUser().name);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const loadInventory = useCallback(async () => {
    const [invRes, empRes] = await Promise.all([
      supabase.from("inventory_items").select("*"),
      supabase.from("employees").select("*"),
    ]);
    if (invRes.data) setInv(invRes.data as InventoryItemRow[]);
    if (empRes.data) {
      const empList = empRes.data as EmployeeRow[];
      setEmployees(empList);
      if (empList.length > 0) {
        const firstEmpName = empList[0]?.name || empList[0]?.full_name;
        if (firstEmpName && master === "Unverified Session") {
          setMaster(firstEmpName);
        }
      }
    }
  }, [master]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const inWNum = parseFloat(inW) || 0;
  const curPNum = parseInt(curP, 10) || 999;
  const tarPNum = parseInt(tarP, 10) || 585;
  const alloy = GoldEngine.calculateAlloy(inWNum, curPNum, tarPNum, ratio);

  const scNum = parseFloat(scrapW) || 0;
  const ePNum = parseInt(estP, 10) || 585;
  const oWNum = parseFloat(outW) || 0;
  const oPNum = parseInt(outP, 10) || 999;
  const refining = GoldEngine.calculateRefining(scNum, ePNum, oWNum, oPNum);
  const { expectedFine, actualFine, refLoss, copperRemoved } = refining;

  // 13-BAND: LIGATURA VA PROBA KO'TARISH AMALIYOTINI OMBOR VA GOLD LEDGERGA ATOMIK YOZISH
  const executeAlloyTransaction = async () => {
    if (busyRef.current || busy) return;
    if (!RBAC.can("edit_inventory")) {
      alert("Ruxsat yo'q!");
      return;
    }
    if (inWNum <= 0 || curPNum <= 0 || tarPNum <= 0 || curPNum === tarPNum) {
      alert("Kirish vazni va probalar to'g'ri kiritilishi shart!");
      return;
    }

    const sourceItem = inv.find((x) => x.category === "Gold" && Number(x.proba) === curPNum);
    if (!sourceItem) {
      alert(
        `SAFE omborida ${curPNum} probali manba oltin topilmadi! Avtomatik yaratish taqiqlangan.`
      );
      return;
    }
    const availableSource = Number(sourceItem.on_hand || 0) - Number(sourceItem.reserved || 0);
    if (availableSource < inWNum) {
      alert(
        `SAFE omborida yetarli ${curPNum} probali oltin yo'q! Mavjud: ${availableSource.toFixed(2)} gr, Talab: ${inWNum.toFixed(2)} gr.`
      );
      return;
    }

    const targetItem = inv.find((x) => x.category === "Gold" && Number(x.proba) === tarPNum);
    if (!targetItem) {
      alert(
        `SAFE omborida ${tarPNum} probali maqsadli oltin yozuvi topilmadi! Avval Ombor bo'limida ro'yxatdan o'tkazing.`
      );
      return;
    }

    let fineGoldItem: InventoryItemRow | undefined;
    if (alloy.fineGoldToAdd > 0) {
      fineGoldItem = inv.find(
        (x) => x.category === "Gold" && Number(x.proba) === 999 && x.id !== sourceItem.id
      );
      const availFine = fineGoldItem
        ? Number(fineGoldItem.on_hand || 0) - Number(fineGoldItem.reserved || 0)
        : 0;
      if (!fineGoldItem || availFine < alloy.fineGoldToAdd) {
        alert(
          `Probani ko'tarish uchun qo'shimcha ${alloy.fineGoldToAdd.toFixed(2)} gr 999 probali sof oltin SAFE omborida yetarli emas!`
        );
        return;
      }
    }

    const silverItem = inv.find((x) => x.category === "Silver");
    const copperItem = inv.find((x) => x.category === "Copper" || x.category === "Alloy");

    if (silverItem && alloy.silverDeducted > 0) {
      const availSilver = Number(silverItem.on_hand || 0) - Number(silverItem.reserved || 0);
      if (availSilver < alloy.silverDeducted) {
        alert(
          `Omborida yetarli Kumush (Silver) ligaturasi yo'q! Mavjud: ${availSilver.toFixed(2)} gr, Talab: ${alloy.silverDeducted.toFixed(2)} gr.`
        );
        return;
      }
    }
    if (copperItem && alloy.copperDeducted > 0) {
      const availCopper = Number(copperItem.on_hand || 0) - Number(copperItem.reserved || 0);
      if (availCopper < alloy.copperDeducted) {
        alert(
          `Omborida yetarli Mis (Copper/Ligatura) yo'q! Mavjud: ${availCopper.toFixed(2)} gr, Talab: ${alloy.copperDeducted.toFixed(2)} gr.`
        );
        return;
      }
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("alloy");
      const { error } = await supabase.rpc("rpc_execute_alloy_transaction", {
        p_source_item_id: sourceItem.id,
        p_target_item_id: targetItem.id,
        p_input_weight: inWNum,
        p_source_proba: curPNum,
        p_target_proba: tarPNum,
        p_ligature_weight: alloy.ligatureNeeded,
        p_fine_gold_added: alloy.fineGoldToAdd,
        p_output_weight: alloy.totalWeight,
        p_pure_gold: alloy.pureGold,
        p_fine_gold_item_id: fineGoldItem?.id ?? null,
        p_silver_item_id: silverItem?.id ?? null,
        p_silver_weight: alloy.silverDeducted,
        p_copper_item_id: copperItem?.id ?? null,
        p_copper_weight: alloy.copperDeducted,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik tranzaksiya rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_execute_alloy_transaction funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "gold_transactions",
        action: "ALLOY_TRANSACTION",
        newData: {
          sourceItemId: sourceItem.id,
          targetItemId: targetItem.id,
          fineGoldItemId: fineGoldItem?.id ?? null,
          inputWeight: inWNum,
          ...alloy,
        },
      });
      await loadInventory();
      alert(
        `Qotishma tranzaksiyasi bajarildi: ${inWNum}g (${curPNum}) -> ${alloy.totalOutputWeight}g (${tarPNum} proba) SAFE omboriga kirim qilindi!`
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // 14-BAND: AFFINAJ TRANZAKSIYASI (SCRAP -> AFFINAJ -> 999 GOLD SAFE + LOSS)
  const executeAffinajTransaction = async () => {
    if (busyRef.current || busy) return;
    if (!RBAC.can("edit_inventory")) {
      alert("Ruxsat yo'q!");
      return;
    }
    if (scNum <= 0 || oWNum <= 0 || ePNum <= 0 || oPNum <= 0) {
      alert("Lom vazni va chiqish vazni 0 dan katta bo'lishi shart!");
      return;
    }
    if (actualFine > expectedFine + 0.05) {
      alert(
        `Affinaj chiqishidagi sof oltin (${actualFine.toFixed(2)}g) kirish lomidagi kutilgan sof oltindan (${expectedFine.toFixed(2)}g) ko'p bo'lishi mumkin emas!`
      );
      return;
    }

    const scrapSource = inv.find(
      (x) =>
        (x.category === "Scrap" || x.category === "Lom") && Number(x.proba || ePNum) === ePNum
    );
    if (!scrapSource) {
      alert(
        `Ombor (inventory_items) da ${ePNum} probali Lom/Scrap manba yozuvi topilmadi! Manba inventarsiz affinaj o'tkazish taqiqlangan.`
      );
      return;
    }
    const availableScrap = Number(scrapSource.on_hand || 0) - Number(scrapSource.reserved || 0);
    if (availableScrap < scNum) {
      alert(
        `Manba Lom/Scrap qoldig'i yetarli emas! Mavjud: ${availableScrap.toFixed(2)} gr, Talab: ${scNum.toFixed(2)} gr.`
      );
      return;
    }

    const targetGoldItem = inv.find((x) => x.category === "Gold" && Number(x.proba) === oPNum);
    if (!targetGoldItem) {
      alert(
        `SAFE omborida ${oPNum} probali sof oltin yozuvi topilmadi! Avtomatik inventar yaratish taqiqlangan.`
      );
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const idempotencyKey = generateIdempotencyKey("affinaj");
      const { error } = await supabase.rpc("rpc_execute_affinaj_transaction", {
        p_scrap_item_id: scrapSource.id,
        p_target_gold_item_id: targetGoldItem.id,
        p_scrap_weight: scNum,
        p_estimated_proba: ePNum,
        p_output_weight: oWNum,
        p_output_proba: oPNum,
        p_expected_fine: expectedFine,
        p_actual_fine: actualFine,
        p_refining_loss: refLoss,
        p_master_name: master,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        alert(
          `Atomik affinaj tranzaksiyasi rad etildi (qisman yozish oldi olindi): ${error.message}. Iltimos, rpc_execute_affinaj_transaction funksiyasi bazada o'rnatilganligini tekshiring.`
        );
        return;
      }

      await logErpAudit({
        table: "gold_transactions",
        action: "AFFINAJ_COMPLETE",
        newData: {
          scrapItemId: scrapSource.id,
          targetGoldItemId: targetGoldItem.id,
          scNum,
          oWNum,
          expectedFine,
          actualFine,
          refLoss,
          master,
        },
      });
      await loadInventory();
      alert(
        `Affinaj yakunlandi! ${oWNum} gr (${oPNum}) sof oltin SAFE omboriga kirim qilindi. Pateriya: ${refLoss} gr.`
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-8 text-slate-800 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        Proba, Ligatura va Affinaj Markazi (Central GoldEngine)
      </h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
          <h2 className="text-lg font-bold border-b pb-2">
            ⚖️ Proba tushirish / ko&apos;tarish (Qotishma &amp; Ligatura)
          </h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <label className="text-xs font-semibold text-slate-500">Kirish vazni (gr)</label>
              <input
                type="number"
                value={inW}
                onChange={(e) => setInW(e.target.value)}
                className="w-full border rounded-xl p-2.5 mt-1 font-bold"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Joriy proba</label>
              <input
                type="number"
                value={curP}
                onChange={(e) => setCurP(e.target.value)}
                className="w-full border rounded-xl p-2.5 mt-1 font-bold"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Maqsadli proba</label>
              <input
                type="number"
                value={tarP}
                onChange={(e) => setTarP(e.target.value)}
                className="w-full border rounded-xl p-2.5 mt-1 font-bold"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">
              Nisbat: {ratio}% yangi / {100 - ratio}% eski oltin
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={ratio}
              onChange={(e) => setRatio(Number(e.target.value))}
              className="w-full mt-1"
            />
          </div>
          <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Sof oltin (999.9):</span>
              <b className="text-amber-800">{alloy.fineGold.toFixed(2)} gr</b>
            </div>
            <div className="flex justify-between">
              <span>Qo&apos;shiladigan ligatura (Mis/Kumush):</span>
              <b className="text-red-600">+{alloy.requiredLigature.toFixed(2)} gr</b>
            </div>
            {alloy.fineGoldToAdd > 0 && (
              <div className="flex justify-between">
                <span>SAFE omboridan sarflanadigan 999 sof oltin:</span>
                <b className="text-amber-700">+{alloy.fineGoldToAdd.toFixed(4)} gr</b>
              </div>
            )}
            <div className="flex justify-between border-t pt-2">
              <span>Jami tayyor qotishma ({tarP}):</span>
              <b className="text-emerald-700 text-base">{alloy.totalOutputWeight.toFixed(2)} gr</b>
            </div>
            <div className="text-xs text-slate-500 bg-white p-2 rounded border">
              Tavsiya: {alloy.newGoldShare}g yangi + {alloy.oldGoldShare}g eski oltin | Kumush:{" "}
              {alloy.silverPart}g, Mis: {alloy.copperPart}g
            </div>
          </div>
          <button
            onClick={() => void executeAlloyTransaction()}
            disabled={busy}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl shadow"
          >
            🔥 Qotishmani tasdiqlash va Gold Ledgerga yozish
          </button>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
          <h2 className="text-lg font-bold border-b pb-2">
            🧪 Tillani tozalash (Affinaj Transaction)
          </h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <label className="text-xs font-semibold text-slate-500">
                Lom / Sprue / Qirindi (gr)
              </label>
              <input
                type="number"
                value={scrapW}
                onChange={(e) => setScrapW(e.target.value)}
                className="w-full border rounded-xl p-2.5 mt-1 font-bold"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Taxminiy probasi</label>
              <input
                type="number"
                value={estP}
                onChange={(e) => setEstP(e.target.value)}
                className="w-full border rounded-xl p-2.5 mt-1 font-bold"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <label className="text-xs font-semibold text-emerald-700">
                Chiqdi sof oltin (gr)
              </label>
              <input
                type="number"
                step="0.01"
                value={outW}
                onChange={(e) => setOutW(e.target.value)}
                className="w-full border-2 border-emerald-500 rounded-xl p-2.5 mt-1 font-bold"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Chiqish probasi</label>
              <input
                type="number"
                value={outP}
                onChange={(e) => setOutP(e.target.value)}
                className="w-full border rounded-xl p-2.5 mt-1 font-bold"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Mas&apos;ul usta</label>
              <input
                list="calc-emp-list"
                value={master}
                onChange={(e) => setMaster(e.target.value)}
                className="w-full border rounded-xl p-2.5 mt-1 font-bold"
              />
              <datalist id="calc-emp-list">
                {employees.map((em, idx) => (
                  <option key={idx} value={em.name || em.full_name} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Kutilgan sof tilla (999):</span>
              <b className="text-blue-900">{expectedFine.toFixed(2)} gr</b>
            </div>
            <div className="flex justify-between">
              <span>Haqiqiy olingan sof tilla:</span>
              <b className="text-emerald-700">{actualFine.toFixed(2)} gr</b>
            </div>
            <div className="flex justify-between">
              <span>Ajralgan mis/shlak:</span>
              <b className="text-slate-600">{copperRemoved.toFixed(2)} gr</b>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span>Affinaj yo&apos;qotishi (Pateriya):</span>
              <b className="text-red-600">{refLoss.toFixed(2)} gr</b>
            </div>
          </div>
          <button
            onClick={() => void executeAffinajTransaction()}
            disabled={busy}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow"
          >
            🧪 Affinajni yakunlash va SAFE Omborga kirim qilish
          </button>
        </div>
      </div>
    </div>
  );
}
