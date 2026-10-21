"use client";

import React, { useState, useMemo } from "react";
import { formatGrams } from "@/lib/barcode-scanner-engine";
import type { ConsignmentPieceRow, SellerGoldAccountRow } from "@/lib/erp-engine";

interface SellerItem {
  id: string;
  name: string;
  full_name?: string;
  phone?: string;
}

interface Props {
  pieces: ConsignmentPieceRow[];
  sellers: SellerItem[];
  sellerAccounts: SellerGoldAccountRow[];
}

export function SellerInventoryDashboard({ pieces, sellers, sellerAccounts }: Props) {
  const [selectedSellerFilter, setSelectedSellerFilter] = useState("all");
  const [modelSearch, setModelSearch] = useState("");

  const filteredPieces = useMemo(() => {
    return pieces.filter((p) => {
      if (selectedSellerFilter !== "all" && String(p.seller_id) !== selectedSellerFilter) {
        return false;
      }
      if (modelSearch.trim()) {
        const q = modelSearch.toLowerCase();
        const mName = (p.model_name || "").toLowerCase();
        const mCode = (p.model_code || "").toLowerCase();
        if (!mName.includes(q) && !mCode.includes(q)) return false;
      }
      return true;
    });
  }, [pieces, selectedSellerFilter, modelSearch]);

  // Aggregate by Seller + Model
  const aggregatedInventory = useMemo(() => {
    const groups: Record<
      string,
      {
        sellerId: string;
        sellerName: string;
        modelCode: string;
        modelName: string;
        category?: string;
        consignedQty: number;
        consignedGrams: number;
        soldQty: number;
        soldGrams: number;
        availableQty: number;
        availableGrams: number;
        returnedQty: number;
        returnedGrams: number;
      }
    > = {};

    for (const p of filteredPieces) {
      const seller = sellers.find((s) => String(s.id) === String(p.seller_id));
      const sName = seller?.full_name || seller?.name || "Sotuvchi";
      const key = `${p.seller_id}_${p.model_code}`;

      if (!groups[key]) {
        groups[key] = {
          sellerId: p.seller_id,
          sellerName: sName,
          modelCode: p.model_code,
          modelName: p.model_name,
          category: p.category,
          consignedQty: 0,
          consignedGrams: 0,
          soldQty: 0,
          soldGrams: 0,
          availableQty: 0,
          availableGrams: 0,
          returnedQty: 0,
          returnedGrams: 0,
        };
      }

      const w = Number(p.weight_grams || 0);
      groups[key].consignedQty += 1;
      groups[key].consignedGrams = Math.round((groups[key].consignedGrams + w) * 10000) / 10000;

      if (p.status === "sold") {
        groups[key].soldQty += 1;
        groups[key].soldGrams = Math.round((groups[key].soldGrams + w) * 10000) / 10000;
      } else if (p.status === "held_by_seller") {
        groups[key].availableQty += 1;
        groups[key].availableGrams = Math.round((groups[key].availableGrams + w) * 10000) / 10000;
      } else if (p.status === "returned_to_factory") {
        groups[key].returnedQty += 1;
        groups[key].returnedGrams = Math.round((groups[key].returnedGrams + w) * 10000) / 10000;
      }
    }

    return Object.values(groups);
  }, [filteredPieces, sellers]);

  // Overall totals
  const totals = useMemo(() => {
    let consignedQty = 0;
    let consignedGrams = 0;
    let soldQty = 0;
    let soldGrams = 0;
    let availableQty = 0;
    let availableGrams = 0;

    for (const item of aggregatedInventory) {
      consignedQty += item.consignedQty;
      consignedGrams = Math.round((consignedGrams + item.consignedGrams) * 10000) / 10000;
      soldQty += item.soldQty;
      soldGrams = Math.round((soldGrams + item.soldGrams) * 10000) / 10000;
      availableQty += item.availableQty;
      availableGrams = Math.round((availableGrams + item.availableGrams) * 10000) / 10000;
    }

    const tillScrap = sellerAccounts.reduce(
      (acc, s) => acc + Number(s.seller_till_scrap_grams || 0),
      0
    );
    const tillCash = sellerAccounts.reduce(
      (acc, s) => acc + Number(s.seller_till_cash_amount || 0),
      0
    );

    return {
      consignedQty,
      consignedGrams,
      soldQty,
      soldGrams,
      availableQty,
      availableGrams,
      tillScrap,
      tillCash,
    };
  }, [aggregatedInventory, sellerAccounts]);

  return (
    <div className="space-y-6">
      {/* Header & Filters */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl text-white space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-xl font-black text-amber-300 flex items-center gap-2">
              <span>📊</span> Sotuvchilar Ombori va Donabay Qoldiqlar
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Har bir sotuvchiga topshirilgan, sotilgan va qoldiqdagi aniq donalar va jismoniy vaznlar mutanosibligi
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <select
              value={selectedSellerFilter}
              onChange={(e) => setSelectedSellerFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium"
            >
              <option value="all">Barcha Sotuvchilar</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name || s.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder="Model qidirish..."
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white w-48"
            />
          </div>
        </div>

        {/* High-contrast metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              Jami Topshirilgan (Konsignatsiya)
            </div>
            <div className="text-xl font-black text-amber-300 font-mono">
              {totals.consignedQty} dona{" "}
              <span className="text-slate-400 font-normal">/ {formatGrams(totals.consignedGrams)} g</span>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              Mijozlarga Sotilgan
            </div>
            <div className="text-xl font-black text-cyan-300 font-mono">
              {totals.soldQty} dona{" "}
              <span className="text-slate-400 font-normal">/ {formatGrams(totals.soldGrams)} g</span>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-emerald-800/40 space-y-1">
            <div className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              Hozirgi Ombor Qoldig&apos;i
            </div>
            <div className="text-xl font-black text-emerald-400 font-mono">
              {totals.availableQty} dona{" "}
              <span className="text-slate-400 font-normal">/ {formatGrams(totals.availableGrams)} g</span>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              Sotuvchi Kassalari
            </div>
            <div className="text-sm font-bold text-slate-200 font-mono">
              <span className="text-amber-300">{formatGrams(totals.tillScrap)} g lom</span>
              <br />
              <span className="text-emerald-400">{totals.tillCash.toLocaleString()} UZS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Reconciliation Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
            Sotuvchi va Model Bo&apos;yicha Qoldiqlar ({aggregatedInventory.length})
          </h3>
          <span className="text-xs text-slate-400">
            Mustaqil tekshiruv: Qoldiq = Topshirilgan - Sotilgan
          </span>
        </div>

        {aggregatedInventory.length === 0 ? (
          <div className="bg-slate-950 rounded-2xl p-8 text-center text-xs text-slate-500 border border-slate-800">
            Hech qanday mahsulot donasi topilmadi.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Sotuvchi</th>
                  <th className="py-3 px-4">Model Kodi</th>
                  <th className="py-3 px-4">Model Nomi</th>
                  <th className="py-3 px-4 font-mono text-amber-200">Topshirildi (Dona / Vazn)</th>
                  <th className="py-3 px-4 font-mono text-cyan-200">Sotildi (Dona / Vazn)</th>
                  <th className="py-3 px-4 font-mono text-emerald-300">Qoldiq Ombor (Dona / Vazn)</th>
                  <th className="py-3 px-4 text-center">Mutanosiblik</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {aggregatedInventory.map((item) => {
                  const returnedQ = item.returnedQty || 0;
                  const returnedG = item.returnedGrams || 0;
                  const isQtyValid = item.availableQty === item.consignedQty - item.soldQty - returnedQ;
                  const isGramsValid =
                    formatGrams(item.availableGrams) ===
                    formatGrams(Math.max(0, item.consignedGrams - item.soldGrams - returnedG));
                  const isBalanced = isQtyValid && isGramsValid;

                  return (
                    <tr key={`${item.sellerId}_${item.modelCode}`} className="hover:bg-slate-900/50">
                      <td className="py-3 px-4 font-bold text-white">{item.sellerName}</td>
                      <td className="py-3 px-4 font-mono text-amber-300">{item.modelCode}</td>
                      <td className="py-3 px-4 text-slate-300">{item.modelName}</td>
                      <td className="py-3 px-4 font-mono text-amber-200">
                        {item.consignedQty} dona ({formatGrams(item.consignedGrams)} g)
                      </td>
                      <td className="py-3 px-4 font-mono text-cyan-200">
                        {item.soldQty} dona ({formatGrams(item.soldGrams)} g)
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-400 text-sm">
                        {item.availableQty} dona ({formatGrams(item.availableGrams)} g)
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isBalanced ? (
                          <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-bold">
                            ✓ 100% Mos
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-rose-950 text-rose-300 border border-rose-800 rounded text-[10px] font-bold">
                            ✕ Nomutanosib
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
