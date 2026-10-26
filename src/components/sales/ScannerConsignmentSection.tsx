"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  createEmptyScanSession,
  processScannedCode,
  removePieceFromSession,
  undoLastScannedPiece,
  playScannerBeep,
  saveSessionToStorage,
  loadSessionFromStorage,
  clearSessionFromStorage,
  formatGrams,
  formatScreenGrams,
  type DraftScanSession,
  type JewelryModelItem,
  type Scanner564Config,
  DEFAULT_SCANNER_CONFIG,
  STANDARD_VAZN_MODEL_ID,
} from "@/lib/barcode-scanner-engine";
import { ModelPhotoThumbnail } from "./ModelPhotoThumbnail";
import { parseErrorMessage } from "@/lib/error-utils";

interface SellerItem {
  id: string;
  name: string;
  full_name?: string;
  phone?: string;
}

interface MarkupPreset {
  id: string;
  name: string;
  percentage: number;
  is_default?: boolean;
}

interface Props {
  activeSellers: SellerItem[];
  availableModels: JewelryModelItem[];
  factoryPresets: MarkupPreset[];
  availableFactoryReceipts?: Array<{
    id: string;
    receipt_no: string;
    product_name: string;
    available_physical_g?: number;
    factory_markup_pct?: number;
  }>;
  onConfirmConsignment: (payload: {
    sellerId: string;
    factoryMarkupPct: number;
    sellerMarkupPct?: number;
    factoryReceiptId?: string;
    pieces: Array<{
      model_id?: string;
      model_code: string;
      model_name: string;
      category?: string;
      purity: number;
      weight_grams: number;
      raw_barcode: string;
    }>;
    notes?: string;
  }) => Promise<void>;
  isBusy?: boolean;
}

export function ScannerConsignmentSection({
  activeSellers,
  availableModels,
  factoryPresets,
  availableFactoryReceipts,
  onConfirmConsignment,
  isBusy,
}: Props) {
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [selectedReceiptId, setSelectedReceiptId] = useState("");
  const [factoryMarkupPct, setFactoryMarkupPct] = useState("8.00");
  const [sellerMarkupPct, setSellerMarkupPct] = useState("12.00");
  const [notes, setNotes] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [session, setSession] = useState<DraftScanSession>(createEmptyScanSession());
  const [config, setConfig] = useState<Scanner564Config>(DEFAULT_SCANNER_CONFIG);
  const [operatorConfirmed, setOperatorConfirmed] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{
    text: string;
    type: "success" | "warning" | "error" | "info";
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const initializedPresetRef = useRef(false);

  // Load persisted draft session from storage on mount
  useEffect(() => {
    const saved = loadSessionFromStorage();
    if (saved && saved.pieces && saved.pieces.length > 0) {
      setSession(saved);
      setStatusNotice({
        text: `Avvalgi qoralama tiklandi (${saved.pieces.length} dona, ${formatScreenGrams(saved.totalWeightGrams, 2)})`,
        type: "info",
      });
    }
  }, []);

  // Save session changes to localStorage
  useEffect(() => {
    if (session.pieces.length > 0) {
      saveSessionToStorage(session);
    } else {
      clearSessionFromStorage();
    }
  }, [session]);

  // Set default factory markup preset once on mount if not already set
  useEffect(() => {
    if (!initializedPresetRef.current && factoryPresets.length > 0) {
      const def = factoryPresets.find((p) => p.is_default) || factoryPresets[0];
      if (def && (!factoryMarkupPct || factoryMarkupPct === "8.00")) {
        setFactoryMarkupPct(String(def.percentage));
      }
      initializedPresetRef.current = true;
    }
  }, [factoryPresets, factoryMarkupPct]);

  const handleSelectReceipt = (id: string) => {
    setSelectedReceiptId(id);
    if (id && availableFactoryReceipts) {
      const match = availableFactoryReceipts.find((r) => r.id === id);
      const rMarkup = match?.factory_markup_pct;
      if (typeof rMarkup === "number" && rMarkup >= 0) {
        setFactoryMarkupPct(String(rMarkup));
      }
    }
  };

  // Auto-focus barcode input
  const keepFocus = () => {
    inputRef.current?.focus();
  };

  useEffect(() => {
    keepFocus();
  }, [session.activeModel]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan(inputVal);
    } else if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleUndo();
    }
  };

  const handleScan = (code: string) => {
    const raw = code.trim();
    if (!raw) return;

    setInputVal("");

    const result = processScannedCode(raw, session, availableModels, config);

    if (result.success) {
      setSession(result.session);
      if (result.action === "model_switched") {
        if (config.beepEnabled) playScannerBeep("model_switch");
        setStatusNotice({ text: result.message, type: "success" });
      } else if (result.action === "piece_added") {
        if (config.beepEnabled) playScannerBeep("success");
        setStatusNotice({ text: result.message, type: "success" });
      }
    } else {
      if (result.action === "duplicate_warning") {
        if (config.beepEnabled) playScannerBeep("duplicate_warning");
        setStatusNotice({ text: result.message, type: "warning" });
      } else {
        if (config.beepEnabled) playScannerBeep("error");
        setStatusNotice({ text: result.message, type: "error" });
      }
    }
    keepFocus();
  };

  const handleManualModelSelect = (mId: string) => {
    const m = availableModels.find((mod) => String(mod.id) === mId);
    if (m) {
      setSession((prev) => ({
        ...prev,
        activeModel: m,
      }));
      if (config.beepEnabled) playScannerBeep("model_switch");
      setStatusNotice({
        text: `Faol model tanlandi: ${m.name} (${m.model_code})`,
        type: "success",
      });
      keepFocus();
    }
  };

  const handleUndo = () => {
    const { session: newSession, removedPiece } = undoLastScannedPiece(session);
    setSession(newSession);
    if (removedPiece) {
      setStatusNotice({
        text: `Oxirgi dona bekor qilindi: ${removedPiece.modelName} (${formatGrams(removedPiece.weightGrams)}g)`,
        type: "info",
      });
    }
    keepFocus();
  };

  const handleRemovePiece = (id: string) => {
    const newSession = removePieceFromSession(session, id);
    setSession(newSession);
    keepFocus();
  };

  const handleClearSession = () => {
    if (confirm("Haqiqatan ham barcha skanerlangan donalarni o'chirmoqchimisiz?")) {
      setSession(createEmptyScanSession());
      clearSessionFromStorage();
      setStatusNotice({ text: "Skanerlash sessiyasi tozalandi", type: "info" });
    }
    keepFocus();
  };

  const handleConfirm = async () => {
    if (isBusy || isSubmitting) return;

    if (!selectedSellerId) {
      setStatusNotice({ text: "Iltimos, avval qabul qiluvchi sotuvchini tanlang!", type: "error" });
      return;
    }
    if (session.pieces.length === 0) {
      setStatusNotice({
        text: "Konsignatsiya uchun kamida bitta dona skaner qilinishi shart!",
        type: "error",
      });
      return;
    }

    if (!operatorConfirmed) {
      setStatusNotice({
        text: "Iltimos, donalar soni va vazni to'g'riligini tasdiqlovchi katakchani belgilang!",
        type: "error",
      });
      return;
    }

    setIsSubmitting(true);

    const piecesPayload = session.pieces.map((p) => {
      let resolvedModelId = p.modelId;
      if (!resolvedModelId || resolvedModelId === "00000000-0000-0000-0000-000000000000") {
        const found = availableModels.find(
          (m) =>
            (m.model_code || "").toUpperCase() === (p.modelCode || "").toUpperCase() ||
            (m.model_code || "").toUpperCase() === "VAZN"
        );
        resolvedModelId = found?.id || STANDARD_VAZN_MODEL_ID;
      }
      return {
        model_id: resolvedModelId,
        model_code: p.modelCode || "VAZN",
        model_name: p.modelName || "Zargarlik Buyumi (Standart 585)",
        category: p.category || "Buyum",
        purity: p.purity || 585,
        weight_grams: p.weightGrams,
        raw_barcode: p.rawBarcode,
      };
    });

    try {
      await onConfirmConsignment({
        sellerId: selectedSellerId,
        factoryMarkupPct: parseFloat(factoryMarkupPct) || 0,
        sellerMarkupPct: parseFloat(sellerMarkupPct) || 12.0,
        factoryReceiptId: selectedReceiptId || undefined,
        pieces: piecesPayload,
        notes: notes.trim() || undefined,
      });

      // Reset session ONLY upon genuine success
      setSession(createEmptyScanSession());
      clearSessionFromStorage();
      setOperatorConfirmed(false);
      setNotes("");
      setStatusNotice({ text: "Konsignatsiya muvaffaqiyatli topshirildi!", type: "success" });
    } catch (err: unknown) {
      // PRESERVE SCANNER DRAFT ON FAILURE! Never lose user scans!
      setStatusNotice({
        text: `Topshirishda xatolik: ${parseErrorMessage(err)}. Skaner qoralamasi to'liq saqlab qolindi!`,
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const fPct = parseFloat(factoryMarkupPct) || 0;
  const sPct = parseFloat(sellerMarkupPct) || 12.0;
  const factoryDueGrams = Math.round(session.totalWeightGrams * (1.0 + fPct / 100.0) * 10000) / 10000;
  const sellerDueGrams = Math.round(session.totalWeightGrams * (1.0 + sPct / 100.0) * 10000) / 10000;

  return (
    <div className="space-y-6">
      {/* Step 1: Configuration Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-xl font-black text-amber-300 flex items-center gap-2">
              <span>⚡</span> Skaner 564 orqali Konsignatsiya Topshirish
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Goldia Skaner 564 tizimi: Model bo&apos;yicha yoki to&apos;g&apos;ridan-to&apos;g&apos;ri dona vazn shtrix-kodlari orqali tezkor kirim
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Ovoz:</span>
            <button
              onClick={() => setConfig({ ...config, beepEnabled: !config.beepEnabled })}
              className={`px-3 py-1 rounded-xl text-xs font-bold border transition ${
                config.beepEnabled
                  ? "bg-emerald-950 border-emerald-700 text-emerald-300"
                  : "bg-slate-800 border-slate-700 text-slate-500"
              }`}
            >
              {config.beepEnabled ? "🔊 Yoniq" : "🔇 O'chiq"}
            </button>
          </div>
        </div>

        {/* Seller & Markup Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="space-y-1">
            <label className="font-bold text-slate-300 block">
              1. Qabul Qiluvchi Sotuvchi <span className="text-rose-400">*</span>:
            </label>
            <select
              id="scannerSellerSelect"
              value={selectedSellerId}
              onChange={(e) => setSelectedSellerId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-medium focus:ring-2 focus:ring-amber-400"
            >
              <option value="">-- Sotuvchini tanlang (Direktor tanlanmaydi) --</option>
              {activeSellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name || s.name} {s.phone ? `(${s.phone})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="font-bold text-slate-300 block">2. Zavod Ustamasi (%):</label>
            <div className="flex gap-2">
              <select
                id="scannerFactoryMarkupSelect"
                value={
                  factoryPresets.some(
                    (p) => String(p.percentage) === factoryMarkupPct || Number(p.percentage) === parseFloat(factoryMarkupPct)
                  )
                    ? factoryMarkupPct
                    : "custom"
                }
                onChange={(e) => {
                  if (e.target.value !== "custom") {
                    setFactoryMarkupPct(e.target.value);
                  }
                }}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold text-amber-300"
              >
                {factoryPresets.map((p) => (
                  <option key={p.id} value={String(p.percentage)}>
                    {p.name} ({p.percentage}%)
                  </option>
                ))}
                {factoryPresets.length === 0 && (
                  <>
                    <option value="6">Zavod 6%</option>
                    <option value="8">Zavod 8% (Standart)</option>
                    <option value="10">Zavod 10%</option>
                  </>
                )}
                {!factoryPresets.some(
                  (p) => String(p.percentage) === factoryMarkupPct || Number(p.percentage) === parseFloat(factoryMarkupPct)
                ) && (
                  <option value="custom">Tanlangan / Kirim ({factoryMarkupPct}%)</option>
                )}
              </select>
              <input
                id="scannerFactoryMarkupInput"
                type="number"
                step="0.1"
                min="0"
                value={factoryMarkupPct}
                onChange={(e) => setFactoryMarkupPct(e.target.value)}
                placeholder="8.00"
                className="w-24 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold text-amber-300 text-center focus:ring-2 focus:ring-amber-400"
                title="Aniq zavod ustamasi (%)"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="font-bold text-slate-300 block">3. Sotuvchi Majburiyati Ustamasi (%):</label>
            <input
              id="scannerSellerMarkupInput"
              type="number"
              step="0.5"
              min="0"
              value={sellerMarkupPct}
              onChange={(e) => setSellerMarkupPct(e.target.value)}
              placeholder="12.00"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-bold text-blue-300 focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {availableFactoryReceipts && availableFactoryReceipts.length > 0 && (
            <div className="space-y-1">
              <label className="font-bold text-slate-300 block">
                Zavod Kirimi Manbasi (Menejer Ombori):
              </label>
              <select
                id="scannerFactoryReceiptSelect"
                value={selectedReceiptId}
                onChange={(e) => handleSelectReceipt(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-xs font-mono"
              >
                <option value="">Avtomatik FIFO (Mavjud kirimdan kamaytirish)</option>
                {availableFactoryReceipts
                  .filter((r) => Number(r.available_physical_g || 0) > 0)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.receipt_no} — {r.product_name} ({formatScreenGrams(Number(r.available_physical_g || 0), 2)} mavjud)
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="font-bold text-slate-300 block">
              3. Qo&apos;lda Model Tanlash (Ixtiyoriy):
            </label>
            <select
              id="manualModelSelect"
              value={session.activeModel?.id || ""}
              onChange={(e) => handleManualModelSelect(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
            >
              <option value="">-- Skaner orqali yoki ro&apos;yxatdan tanlang --</option>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.model_code}) • {m.category || "Серьги"}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Active Model Indicator & Barcode Scan Input */}
      <div className="bg-slate-950 border-2 border-amber-400/50 rounded-3xl p-6 text-white space-y-4 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ModelPhotoThumbnail
              src={session.activeModel?.primary_image_url}
              alt={session.activeModel?.name || "Faol Model"}
              size="lg"
              rounded="2xl"
              className="border-amber-400 shadow-md"
            />
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                Hozirgi Faol Model:
              </div>
              {session.activeModel ? (
                <div id="activeModelDisplay" className="space-y-0.5">
                  <div className="text-lg font-black text-amber-300 flex items-center gap-2">
                    <span id="activeModelName">{session.activeModel.name}</span>
                    <span id="activeModelCode" className="font-mono text-xs px-2 py-0.5 bg-amber-950 text-amber-200 border border-amber-800 rounded">
                      {session.activeModel.model_code}
                    </span>
                  </div>
                  <div className="text-xs text-slate-300">
                    {session.activeModel.category || "Серьги"} • {session.activeModel.decorations || "Standart"} • {session.activeModel.gold_purity || 585}°
                  </div>
                </div>
              ) : (
                <div className="text-sm font-bold text-amber-300 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  Goldia Vazn Rejimi (Standart 585 dona): Vazn shtrix-kodini skaner qiling
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="undoScanBtn"
              onClick={handleUndo}
              disabled={session.pieces.length === 0}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 flex items-center gap-1.5 transition"
            >
              <span>↩️</span> Oxirgisini Bekor Qilish (Ctrl+Z)
            </button>
            <button
              onClick={handleClearSession}
              disabled={session.pieces.length === 0}
              className="px-3.5 py-2 bg-rose-950/60 hover:bg-rose-900 disabled:opacity-40 text-rose-300 font-bold text-xs rounded-xl border border-rose-800 transition"
            >
              Tozalash
            </button>
          </div>
        </div>

        {/* High-speed Scanner Input */}
        <div className="space-y-1">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id="scannerConsignInput"
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                session.activeModel
                  ? `"${session.activeModel.name}" uchun vazn shtrixkodini skaner qiling (masalan: 14.52)...`
                  : "Vazn shtrixkodini skaner qiling (masalan: 14.52)..."
              }
              className="flex-1 bg-slate-900 border-2 border-amber-500 rounded-2xl px-5 py-4 text-white font-mono text-lg font-bold focus:outline-none focus:ring-4 focus:ring-amber-500/20 placeholder:text-slate-600 placeholder:font-sans placeholder:text-sm"
            />
            <button
              onClick={() => handleScan(inputVal)}
              className="px-6 py-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-2xl text-sm transition shadow-lg"
            >
              Qo&apos;shish
            </button>
          </div>

          {statusNotice && (
            <div
              className={`text-xs px-3 py-1.5 rounded-xl font-medium mt-1 flex items-center justify-between ${
                statusNotice.type === "success"
                  ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800"
                  : statusNotice.type === "warning"
                  ? "bg-amber-950/80 text-amber-300 border border-amber-800"
                  : statusNotice.type === "info"
                  ? "bg-cyan-950/80 text-cyan-300 border border-cyan-800"
                  : "bg-rose-950/80 text-rose-300 border border-rose-800"
              }`}
            >
              <span>{statusNotice.text}</span>
              <button
                onClick={() => setStatusNotice(null)}
                className="text-xs opacity-60 hover:opacity-100 ml-2"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Real-time Metrics Summary & Scanned Pieces Table */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Metric Cards (Left column on large screens) */}
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white space-y-3">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Jami Skanerlangan
            </div>
            <div id="draftTotalPieces" className="text-3xl font-black text-amber-300 font-mono">
              {session.totalPieces} <span className="text-base font-normal text-slate-400">dona</span>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-[#F8FAFC] space-y-3">
            <div className="text-xs text-[#CBD5E1] uppercase tracking-wider font-semibold">
              Jami Asl Vazn (585)
            </div>
            <div id="draftTotalWeight" className="text-3xl font-black text-[#F8FAFC] font-mono">
              {formatScreenGrams(session.totalWeightGrams, 2)}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-[#F8FAFC] space-y-3">
            <div className="text-xs text-[#CBD5E1] uppercase tracking-wider font-semibold">
              Zavod Majburiyati (+{fPct}%)
            </div>
            <div id="draftFactoryDue" className="text-3xl font-black text-emerald-400 font-mono">
              {formatScreenGrams(factoryDueGrams, 2)}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-[#F8FAFC] space-y-3">
            <div className="text-xs text-[#CBD5E1] uppercase tracking-wider font-semibold">
              Sotuvchi Majburiyati (+{sPct}%)
            </div>
            <div id="draftSellerDue" className="text-3xl font-black text-blue-400 font-mono">
              {formatScreenGrams(sellerDueGrams, 2)}
            </div>
          </div>

          {/* Model Breakdown */}
          {Object.keys(session.byModel).length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-[#F8FAFC] space-y-3 text-xs">
              <div className="font-bold text-[#CBD5E1] uppercase tracking-wider">
                Modellar Bo&apos;yicha Taqsimot:
              </div>
              <div className="space-y-2">
                {Object.values(session.byModel).map((grp) => (
                  <div
                    key={grp.modelCode}
                    className="flex justify-between items-center py-1.5 border-b border-slate-800"
                  >
                    <div className="flex items-center gap-2">
                      <ModelPhotoThumbnail
                        src={grp.primary_image_url}
                        alt={grp.modelName}
                        size="xs"
                        rounded="md"
                      />
                      <div>
                        <div className="font-bold">{grp.modelName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{grp.modelCode}</div>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="font-bold text-amber-300">{grp.count} dona</div>
                      <div className="text-slate-400">{formatScreenGrams(grp.totalWeightGrams, 2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Scanned Pieces Table (Right 3 cols) */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-3xl p-5 text-white space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
                Partiyadagi Donalar ({session.pieces.length})
              </h3>
              <span className="text-xs text-slate-500">
                Har bir donaga tizim ichki unikal identifikator beradi
              </span>
            </div>

            {session.pieces.length === 0 ? (
              <div className="bg-slate-950 rounded-2xl p-12 text-center text-xs text-slate-500 border border-slate-800">
                <div className="text-3xl mb-2">📦</div>
                Hozircha hech qanday dona skaner qilinmadi.
                <div className="mt-1 text-slate-400">
                  Vazn shtrix-kodini skanerlang (zarurat bo&apos;lsa model QR kodi bilan).
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 max-h-[420px] overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/80 text-[#CBD5E1] font-semibold border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Rasm</th>
                      <th className="py-2.5 px-3">Model</th>
                      <th className="py-2.5 px-3">Model Kodi</th>
                      <th className="py-2.5 px-3">Asl Vazn (585)</th>
                      <th className="py-2.5 px-3">Xom Shtrix-kod</th>
                      <th className="py-2.5 px-3 text-right">Amal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {session.pieces.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2 px-3">
                          <ModelPhotoThumbnail
                            src={p.primary_image_url}
                            alt={p.modelName}
                            size="xs"
                            rounded="md"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#F8FAFC]">{p.modelName}</td>
                        <td className="py-2.5 px-3 font-mono text-amber-300">{p.modelCode}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-emerald-400 text-sm">
                          {formatScreenGrams(p.weightGrams, 2)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-400">{p.rawBarcode}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => handleRemovePiece(p.id)}
                            className="text-rose-400 hover:text-rose-200 text-xs px-2 py-1 rounded hover:bg-rose-950"
                          >
                            O&apos;chirish
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Operator Confirmation & Duplicate Warning Notice */}
          {session.pieces.length > 0 && (
            <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-2xl text-amber-200 text-xs space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-amber-300">
                <span>⚠️</span> Operator Diqqatiga:
              </div>
              <p className="text-[11px] text-amber-300/80 leading-relaxed">
                Chiziqli shtrix-kod faqat vazn raqamini (masalan: 14.52g) o&apos;z ichiga oladi. Bir xil vaznli turli xil donalar bilan tasodifiy qayta skanerlangan donani farqlash uchun operator vizual nazorati shart.
              </p>
              <label className="flex items-center gap-2.5 pt-1 font-bold text-white cursor-pointer select-none">
                <input
                  id="operatorConfirmConsignmentCheckbox"
                  type="checkbox"
                  checked={operatorConfirmed}
                  onChange={(e) => setOperatorConfirmed(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700 focus:ring-emerald-400"
                />
                <span>Barcha {session.totalPieces} dona ({formatScreenGrams(session.totalWeightGrams, 2)}) to&apos;g&apos;ri sanalganini va dublikat yo&apos;qligini tasdiqlayman</span>
              </label>
            </div>
          )}

          {/* Bottom Confirmation Bar */}
          <div className="border-t border-slate-800 pt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Konsignatsiya uchun qo'shimcha izoh..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!selectedSellerId && (
                <span
                  id="scannerMissingSellerNotice"
                  className="text-amber-300 text-xs font-bold flex items-center gap-1.5 bg-amber-950/70 border border-amber-700/80 px-3 py-2.5 rounded-xl shadow-sm"
                >
                  <span>⚠️</span> Avval qabul qiluvchi sotuvchini tanlang
                </span>
              )}

              <button
                id="confirmConsignmentBtn"
                onClick={handleConfirm}
                disabled={isBusy || isSubmitting || session.pieces.length === 0 || !selectedSellerId || !operatorConfirmed}
                className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-black text-sm rounded-xl transition flex items-center gap-2 shadow-lg"
              >
                <span>✓</span>
                {isBusy || isSubmitting
                  ? "Tasdiqlanmoqda..."
                  : `Konsignatsiyani Tasdiqlash (${session.totalPieces} dona, ${formatScreenGrams(session.totalWeightGrams, 2)})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
