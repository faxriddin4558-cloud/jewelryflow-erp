"use client";

import React, { useState, useEffect, useMemo } from "react";
import { formatGrams, formatScreenGrams, type JewelryModelItem } from "@/lib/barcode-scanner-engine";
import { supabase, type ConsignmentPieceRow, type SellerGoldAccountRow, type FactoryReceiptRow } from "@/lib/erp-engine";
import { ModelPhotoThumbnail } from "./ModelPhotoThumbnail";
import { parseErrorMessage } from "@/lib/error-utils";

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
  models?: JewelryModelItem[];
  factoryReceipts?: FactoryReceiptRow[];
  onRefresh?: () => Promise<void>;
  loading?: boolean;
}

export function SellerInventoryDashboard({ pieces, sellers, sellerAccounts, models, factoryReceipts, onRefresh, loading }: Props) {
  const [internalReceipts, setInternalReceipts] = useState<FactoryReceiptRow[]>([]);
  const [viewMode, setViewMode] = useState<"batches" | "pieces" | "aggregated">("batches");
  const [selectedSellerFilter, setSelectedSellerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [modelSearch, setModelSearch] = useState("");
  const [returningPieceId, setReturningPieceId] = useState<string | null>(null);
  const [returnNotes, setReturnNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (factoryReceipts && factoryReceipts.length > 0) return;
    let isMounted = true;
    async function loadReceipts() {
      try {
        const { data } = await supabase.from("factory_receipts").select("*").order("created_at", { ascending: false });
        if (isMounted && data) setInternalReceipts(data as FactoryReceiptRow[]);
      } catch {
        // ignore
      }
    }
    void loadReceipts();
    return () => {
      isMounted = false;
    };
  }, [factoryReceipts]);

  const allReceipts = useMemo(() => {
    return (factoryReceipts && factoryReceipts.length > 0) ? factoryReceipts : internalReceipts;
  }, [factoryReceipts, internalReceipts]);

  const activeBatches = useMemo(() => {
    return allReceipts.filter((r) => r.status !== "reversed" && Number(r.available_physical_g || 0) > 0);
  }, [allReceipts]);

  const batchesAvailableGrams = useMemo(() => {
    return activeBatches.reduce((acc, r) => acc + Number(r.available_physical_g || 0), 0);
  }, [activeBatches]);

  const managerReturnedPieces = useMemo(() => {
    return pieces.filter((p) => p.status === "in_manager_stock" || p.status === "returned_to_manager");
  }, [pieces]);

  const managerPiecesGrams = useMemo(() => {
    return managerReturnedPieces.reduce((acc, p) => acc + Number(p.weight_grams || 0), 0);
  }, [managerReturnedPieces]);

  const totalManagerStockGrams = batchesAvailableGrams + managerPiecesGrams;

  const sellerAvailablePieces = useMemo(() => {
    return pieces.filter((p) => p.status === "held_by_seller");
  }, [pieces]);

  const sellerStockGrams = useMemo(() => {
    if (selectedSellerFilter && selectedSellerFilter !== "all") {
      const match = sellerAccounts.find((s) => String(s.seller_id) === selectedSellerFilter);
      return match ? Number(match.current_physical_stock_g || 0) : sellerAvailablePieces.reduce((acc, p) => acc + Number(p.weight_grams || 0), 0);
    }
    const accTotal = sellerAccounts.reduce((acc, s) => acc + Number(s.current_physical_stock_g || 0), 0);
    return accTotal > 0 ? accTotal : sellerAvailablePieces.reduce((acc, p) => acc + Number(p.weight_grams || 0), 0);
  }, [sellerAccounts, selectedSellerFilter, sellerAvailablePieces]);

  const filteredPieces = useMemo(() => {
    return pieces.filter((p) => {
      if (selectedSellerFilter !== "all" && String(p.seller_id) !== selectedSellerFilter) {
        return false;
      }
      if (statusFilter !== "all" && p.status !== statusFilter) {
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
  }, [pieces, selectedSellerFilter, statusFilter, modelSearch]);

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
        primaryImageUrl?: string | null;
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
        const modelObj = models?.find(
          (m) => m.model_code === p.model_code || m.id === p.model_id
        );
        const imgUrl = p.primary_image_url || p.model?.primary_image_url || modelObj?.primary_image_url || null;

        groups[key] = {
          sellerId: p.seller_id,
          sellerName: sName,
          modelCode: p.model_code,
          modelName: p.model_name,
          category: p.category,
          primaryImageUrl: imgUrl,
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
      } else if (p.status === "returned_to_manager" || p.status === "returned_to_factory") {
        groups[key].returnedQty += 1;
        groups[key].returnedGrams = Math.round((groups[key].returnedGrams + w) * 10000) / 10000;
      }
    }

    return Object.values(groups);
  }, [filteredPieces, sellers, models]);

  // Overall totals
  const totals = useMemo(() => {
    let consignedQty = 0;
    let consignedGrams = 0;
    let soldQty = 0;
    let soldGrams = 0;
    let availableQty = 0;
    let availableGrams = 0;
    let returnedQty = 0;
    let returnedGrams = 0;

    for (const p of filteredPieces) {
      const w = Number(p.weight_grams || 0);
      consignedQty += 1;
      consignedGrams = Math.round((consignedGrams + w) * 10000) / 10000;

      if (p.status === "sold") {
        soldQty += 1;
        soldGrams = Math.round((soldGrams + w) * 10000) / 10000;
      } else if (p.status === "held_by_seller") {
        availableQty += 1;
        availableGrams = Math.round((availableGrams + w) * 10000) / 10000;
      } else if (p.status === "returned_to_manager" || p.status === "returned_to_factory") {
        returnedQty += 1;
        returnedGrams = Math.round((returnedGrams + w) * 10000) / 10000;
      }
    }

    const tillScrap = sellerAccounts.reduce(
      (acc, s) => acc + Number(s.seller_till_scrap_585_eq_g ?? s.seller_till_scrap_grams ?? 0),
      0
    );
    const tillCash = sellerAccounts.reduce(
      (acc, s) => acc + Number(s.seller_till_cash_amount || 0),
      0
    );
    const tillUSD = sellerAccounts.reduce(
      (acc, s) => acc + Number(s.seller_till_usd_amount || 0),
      0
    );

    const truePhysicalStock = selectedSellerFilter === "all"
      ? sellerAccounts.reduce((acc, s) => acc + Number(s.current_physical_stock_g || 0), 0)
      : Number(sellerAccounts.find((s) => String(s.seller_id) === selectedSellerFilter)?.current_physical_stock_g || 0);

    return {
      consignedQty,
      consignedGrams,
      soldQty,
      soldGrams,
      availableQty,
      availableGrams,
      returnedQty,
      returnedGrams,
      tillScrap,
      tillCash,
      tillUSD,
      truePhysicalStock,
    };
  }, [filteredPieces, sellerAccounts, selectedSellerFilter]);

  // Return piece to manager handler
  const handleConfirmReturn = async () => {
    if (!returningPieceId) return;
    setBusy(true);
    setActionMessage(null);
    try {
      const { data, error } = await supabase.rpc("rpc_return_piece_to_manager", {
        p_piece_id: returningPieceId,
        p_notes: returnNotes.trim() || "Sotuvchi tovardan voz kechdi",
      });

      if (error) throw error;

      setActionMessage({
        type: "success",
        text: `Mahsulot (${data?.model_code || ""}, ${Number(data?.weight_grams || 0).toFixed(2)}g) boshqaruvchi omboriga qaytarildi! Sotuvchi majburiyati -${Number(data?.seller_obligation_deducted_g || 0).toFixed(2)}g kamaydi.`,
      });
      setReturningPieceId(null);
      setReturnNotes("");
      if (onRefresh) await onRefresh();
    } catch (err: unknown) {
      setActionMessage({
        type: "error",
        text: `Qaytarishda xatolik: ${parseErrorMessage(err)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const returningPiece = useMemo(() => {
    if (!returningPieceId) return null;
    return pieces.find((p) => p.id === returningPieceId) || null;
  }, [returningPieceId, pieces]);

  const returningMarkupPct = Number(returningPiece?.consignment?.seller_markup_pct ?? 12);
  const returningPieceWeight = Number(returningPiece?.weight_grams ?? 0);
  const returningObligationG = Math.round(returningPieceWeight * (1 + returningMarkupPct / 100) * 10000) / 10000;

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 flex flex-col items-center justify-center min-h-[350px] text-slate-400 space-y-3">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-medium tracking-wide">Ombor va mahsulotlar ma&apos;lumotlari yuklanmoqda...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl text-white space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-xl font-black text-amber-300 flex items-center gap-2">
              <span>💍</span> Zargarlik Ombori & Fizik Qoldiqlar
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Partiyalar va mahsulotlar, individual vazn, rasm, sotuv va boshqaruvchiga qaytarish holati.
            </p>
          </div>

          {/* View mode toggle */}
          <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
            <button
              onClick={() => setViewMode("batches")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                viewMode === "batches"
                  ? "bg-amber-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>📦</span> Zavod Partiyalari ({activeBatches.length})
            </button>
            <button
              onClick={() => setViewMode("pieces")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                viewMode === "pieces"
                  ? "bg-amber-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>🔍</span> Mahsulotlar Ro&apos;yxati ({filteredPieces.length})
            </button>
            <button
              onClick={() => setViewMode("aggregated")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                viewMode === "aggregated"
                  ? "bg-amber-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>📊</span> Modellar Bo&apos;yicha ({aggregatedInventory.length})
            </button>
          </div>
        </div>

        {/* Filters */}
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

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium"
          >
            <option value="all">Barcha Holatlar</option>
            <option value="held_by_seller">Faqat Mavjud (Sotilmagan)</option>
            <option value="sold">Faqat Sotilgan</option>
            <option value="returned_to_manager">Boshqaruvchiga Qaytarilgan</option>
          </select>

          <input
            type="text"
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            placeholder="Model yoki kod qidirish..."
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white w-52"
          />
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-slate-950 p-4 rounded-2xl border border-blue-500/30 space-y-1">
            <div className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              Menejer Ombori (Jami)
            </div>
            <div className="text-xl font-black text-cyan-300 font-mono">
              {formatScreenGrams(totalManagerStockGrams, 2)}
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              Partiyalar: {formatScreenGrams(batchesAvailableGrams, 2)} | Qaytarilgan: {formatScreenGrams(managerPiecesGrams, 2)}
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-emerald-800/40 space-y-1">
            <div className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              Sotuvchilar Vitrinasida
            </div>
            <div className="text-xl font-black text-emerald-400 font-mono">
              {formatScreenGrams(sellerStockGrams, 2)}
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              Mavjud: {sellerAvailablePieces.length} ta mahsulot
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              Mijozlarga Sotilgan
            </div>
            <div className="text-xl font-black text-amber-300 font-mono">
              {formatScreenGrams(totals.soldGrams, 2)}
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
            <div className="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              Menejerga Qaytarilgan
            </div>
            <div className="text-xl font-black text-purple-300 font-mono">
              {formatScreenGrams(totals.returnedGrams, 2)}
            </div>
          </div>
        </div>
      </div>

      {actionMessage && (
        <div
          className={`p-4 rounded-2xl text-xs font-bold border ${
            actionMessage.type === "success"
              ? "bg-emerald-950/80 border-emerald-700 text-emerald-200"
              : "bg-rose-950/80 border-rose-700 text-rose-200"
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* VIEW 0: FACTORY RECEIPT BATCHES (UNSEPARATED BULK STOCK) */}
      {viewMode === "batches" && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-[#F8FAFC] space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                <span>📦</span> Zavoddan Qabul Qilingan Partiyalar
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Zavod kvitansiyalari bo&apos;yicha menejer omboridagi mavjud partiyalar.
              </p>
            </div>
            <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-950/80 px-2.5 py-1 rounded-xl border border-cyan-800">
              Jami Partiyalar Qoldig&apos;i: {formatScreenGrams(batchesAvailableGrams, 2)}
            </span>
          </div>

          {activeBatches.length === 0 ? (
            <div className="bg-slate-950 rounded-2xl p-8 text-center text-xs text-slate-500 border border-slate-800">
              Zavoddan qabul qilingan qoldiq partiyalar mavjud emas (barcha qabul qilingan tovarlar to&apos;liq donalarga ajratilgan).
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[11px] bg-slate-900/60">
                    <th className="p-3">Hujjat No</th>
                    <th className="p-3">Mahsulot Nomi</th>
                    <th className="p-3 text-center">Proba</th>
                    <th className="p-3 text-right">Boshlang&apos;ich Vazn</th>
                    <th className="p-3 text-right">Taqsimlangan</th>
                    <th className="p-3 text-right text-cyan-400 font-bold">Mavjud Qoldiq</th>
                    <th className="p-3 text-center">Ustama</th>
                    <th className="p-3 text-right">Zavod Majburiyati</th>
                    <th className="p-3 text-center">Sana</th>
                    <th className="p-3 text-center">Holat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {activeBatches.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-900/40 transition">
                      <td className="p-3 font-bold text-amber-300">{b.receipt_no}</td>
                      <td className="p-3 font-sans text-slate-200">{b.product_name}</td>
                      <td className="p-3 text-center text-slate-300">{b.proba}</td>
                      <td className="p-3 text-right text-slate-300">{formatScreenGrams(b.original_physical_g, 2)}</td>
                      <td className="p-3 text-right text-slate-400">{formatScreenGrams(b.transferred_physical_g, 2)}</td>
                      <td className="p-3 text-right font-black text-cyan-300">{formatScreenGrams(b.available_physical_g, 2)}</td>
                      <td className="p-3 text-center text-slate-400 font-sans">{b.factory_markup_pct}%</td>
                      <td className="p-3 text-right text-rose-300 font-bold">{formatScreenGrams(b.factory_obligation_g, 2)}</td>
                      <td className="p-3 text-center text-slate-400 text-[11px] font-sans">
                        {new Date(b.receipt_date || b.created_at || "").toLocaleDateString()}
                      </td>
                      <td className="p-3 text-center font-sans">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          {b.status === "in_manager_stock" ? "Seyfda" : b.status === "partially_transferred" ? "Qisman taqsimlangan" : b.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW 1: PIECE-LEVEL INVENTORY (EXACT PHYSICAL ITEMS) */}
      {viewMode === "pieces" && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-[#F8FAFC] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
              Aniq Mahsulotlar Ro&apos;yxati ({filteredPieces.length})
            </h3>
            <span className="text-xs text-slate-400">
              Har bir mahsulot mustaqil ichki identifikatorga ega
            </span>
          </div>

          {filteredPieces.length === 0 ? (
            <div className="bg-slate-950 rounded-2xl p-8 text-center text-xs text-slate-500 border border-slate-800">
              Hech qanday mahsulot topilmadi.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-[#CBD5E1] font-semibold border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-3">Rasm</th>
                    <th className="py-3 px-3">Model</th>
                    <th className="py-3 px-3">Kod</th>
                    <th className="py-3 px-3 font-mono text-amber-300">Aniq Vazn</th>
                    <th className="py-3 px-3">Proba</th>
                    <th className="py-3 px-3">Sotuvchi</th>
                    <th className="py-3 px-3">Holat</th>
                    <th className="py-3 px-3 text-right">Amal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {filteredPieces.map((p) => {
                    const seller = sellers.find((s) => String(s.id) === String(p.seller_id));
                    const modelObj = models?.find(
                      (m) => m.model_code === p.model_code || m.id === p.model_id
                    );
                    const imgUrl = p.primary_image_url || p.model?.primary_image_url || modelObj?.primary_image_url || null;

                    return (
                      <tr key={p.id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3">
                          <ModelPhotoThumbnail
                            src={imgUrl}
                            alt={p.model_name}
                            size="xs"
                            rounded="md"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#F8FAFC]">
                          {p.model_name}
                          <div className="text-[10px] text-slate-400">{p.category || "Buyum"}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-amber-400">{p.model_code}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-emerald-400 text-sm">
                          {formatScreenGrams(p.weight_grams, 2)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-300">{p.purity || 585}</td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {seller?.full_name || seller?.name || "Sotuvchi"}
                        </td>
                        <td className="py-2.5 px-3">
                          {p.status === "held_by_seller" && (
                            <span className="px-2.5 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-lg text-[10px] font-bold">
                              ✓ Javonda (Mavjud)
                            </span>
                          )}
                          {p.status === "sold" && (
                            <span className="px-2.5 py-1 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded-lg text-[10px] font-bold">
                              🛍️ Sotilgan
                            </span>
                          )}
                          {p.status === "returned_to_manager" && (
                            <span className="px-2.5 py-1 bg-amber-950 text-amber-300 border border-amber-800 rounded-lg text-[10px] font-bold">
                              ↩️ Boshqaruvchiga Qaytgan
                            </span>
                          )}
                          {p.status === "returned_to_factory" && (
                            <span className="px-2.5 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded-lg text-[10px] font-bold">
                              🏭 Zavodga Qaytgan
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {p.status === "held_by_seller" && (
                            <button
                              onClick={() => setReturningPieceId(p.id)}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-amber-900/60 text-amber-300 border border-slate-700 hover:border-amber-600 rounded-lg text-[11px] font-bold transition"
                            >
                              Menejerga Qaytarish
                            </button>
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
      )}

      {/* VIEW 2: AGGREGATED VIEW (MODEL-LEVEL) */}
      {viewMode === "aggregated" && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-[#F8FAFC] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
              Sotuvchi va Model Bo&apos;yicha Qoldiqlar ({aggregatedInventory.length})
            </h3>
            <span className="text-xs text-slate-400">
              Qoldiq = Topshirilgan - Sotilgan - Qaytarilgan
            </span>
          </div>

          {aggregatedInventory.length === 0 ? (
            <div className="bg-slate-950 rounded-2xl p-8 text-center text-xs text-slate-500 border border-slate-800">
              Hech qanday mahsulot topilmadi.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-[#CBD5E1] font-semibold border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-3">Rasm</th>
                    <th className="py-3 px-4">Sotuvchi</th>
                    <th className="py-3 px-4">Model Kodi</th>
                    <th className="py-3 px-4">Model Nomi</th>
                    <th className="py-3 px-4 font-mono text-amber-200">Topshirildi (Vazn)</th>
                    <th className="py-3 px-4 font-mono text-cyan-200">Sotildi (Vazn)</th>
                    <th className="py-3 px-4 font-mono text-emerald-300">Qoldiq Ombor (Vazn)</th>
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
                        <td className="py-2 px-3">
                          <ModelPhotoThumbnail
                            src={item.primaryImageUrl}
                            alt={item.modelName}
                            size="xs"
                            rounded="md"
                          />
                        </td>
                        <td className="py-3 px-4 font-bold text-[#F8FAFC]">{item.sellerName}</td>
                        <td className="py-3 px-4 font-mono text-amber-300">{item.modelCode}</td>
                        <td className="py-3 px-4 text-slate-300">{item.modelName}</td>
                        <td className="py-3 px-4 font-mono text-amber-200">
                          {formatScreenGrams(item.consignedGrams, 2)}
                        </td>
                        <td className="py-3 px-4 font-mono text-cyan-200">
                          {formatScreenGrams(item.soldGrams, 2)}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-emerald-400 text-sm">
                          {formatScreenGrams(item.availableGrams, 2)}
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
      )}

      {/* Return to Manager Confirmation Modal */}
      {returningPieceId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl">
            <h3 className="text-lg font-black text-amber-300 flex items-center gap-2">
              <span>↩️</span> Mahsulotni Menejerga Qaytarish
            </h3>
            <p className="text-xs text-slate-300">
              Sotilmagan ushbu mahsulot sotuvchi javonidan chiqarilib, boshqaruvchi omboriga qaytariladi.
              Sotuvchining majburiyati asl konsignatsiya ustamasi ({returningMarkupPct}%) bo&apos;yicha avtomatik kamaytiriladi.
            </p>

            {returningPiece && (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-xs space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-400">
                  <span className="font-sans">Mahsulot / Model:</span>
                  <span className="text-white font-bold">{returningPiece.model_name || returningPiece.model_code}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span className="font-sans">Fizik vazn (585):</span>
                  <span className="text-white font-bold">{formatScreenGrams(returningPieceWeight)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span className="font-sans">Konsignatsiya ustamasi:</span>
                  <span className="text-amber-400 font-bold">{returningMarkupPct}%</span>
                </div>
                <div className="flex justify-between text-slate-400 pt-1 border-t border-slate-800">
                  <span className="font-sans">Kamayadigan majburiyat:</span>
                  <span className="text-emerald-400 font-bold">-{formatScreenGrams(returningObligationG)} (585 eq)</span>
                </div>
                {returningPiece.consignment?.consignment_no && (
                  <div className="flex justify-between text-slate-500 text-[10px] pt-0.5">
                    <span className="font-sans">Hujjat raqami:</span>
                    <span>{returningPiece.consignment.consignment_no}</span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-400">Qaytarish sababi / Izoh</label>
              <textarea
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                placeholder="Masalan: Qayta eritishga yoki boshqa sotuvchiga berish uchun..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReturningPieceId(null)}
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition"
              >
                Bekor Qilish
              </button>
              <button
                type="button"
                onClick={handleConfirmReturn}
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition"
              >
                {busy ? "Qaytarilmoqda..." : "Tasdiqlash & Qaytarish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
