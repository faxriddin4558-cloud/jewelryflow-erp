"use client";

import { useState } from "react";

export interface ReceiptData {
  title: string;
  receiptNo: string;
  date: string;
  sellerName?: string;
  customerName?: string;
  customerCode?: string;
  customerPhone?: string;
  itemName?: string;
  baseWeightGrams?: number;
  purity?: number;
  factoryMarkupPct?: number;
  factoryGoldDueGrams?: number;
  clientMarkupPct?: number;
  clientGoldDueGrams?: number;
  markupSpreadGrams?: number;
  scrapWeightGrams?: number;
  scrapPurity?: number;
  cashAmount?: number;
  goldRateApplied?: number;
  cashEquivalentGrams?: number;
  usdAmount?: number;
  usdRateApplied?: number;
  usdEquivalentGrams?: number;
  totalSettledGrams?: number;
  previousDebtGrams?: number;
  remainingDebtGrams?: number;
  advanceGoldGrams?: number;
  advanceAppliedGrams?: number;
  notes?: string;
}

interface Props {
  data: ReceiptData | null;
  onClose: () => void;
}

export function SalesReceiptModal({ data, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  if (!data) return null;

  const handleCopy = () => {
    const text = `
========================================
JEWELRYFLOW ERP — KVITANSIYA / CHEK
========================================
Hujjat: ${data.title}
Raqam: ${data.receiptNo}
Sana: ${data.date}
${data.sellerName ? `Sotuvchi: ${data.sellerName}` : ""}
${data.customerName ? `Mijoz: ${data.customerName} (${data.customerCode || ""})` : ""}
${data.customerPhone ? `Telefon: ${data.customerPhone}` : ""}
----------------------------------------
${data.itemName ? `Mahsulot: ${data.itemName}` : ""}
${data.baseWeightGrams != null ? `Asl Vazn: ${data.baseWeightGrams.toFixed(4)} g (${data.purity || 585} proba)` : ""}
${data.clientMarkupPct != null ? `Mijoz Ustamasi: ${data.clientMarkupPct}%` : ""}
${data.clientGoldDueGrams != null ? `Mahsulot Oltin Qiymati: ${data.clientGoldDueGrams.toFixed(4)} g` : ""}
${data.factoryMarkupPct != null ? `Zavod Ustamasi: ${data.factoryMarkupPct}%` : ""}
${data.factoryGoldDueGrams != null ? `Zavod Majburiyati: ${data.factoryGoldDueGrams.toFixed(4)} g` : ""}
${data.markupSpreadGrams != null ? `Hisob-kitob Farqi (Spread): ${data.markupSpreadGrams.toFixed(4)} g` : ""}
${data.scrapWeightGrams != null && data.scrapWeightGrams > 0 ? `To'langan Lom: ${data.scrapWeightGrams.toFixed(4)} g` : ""}
${data.cashAmount != null && data.cashAmount > 0 ? `To'langan Naqd: ${data.cashAmount.toLocaleString()} UZS` : ""}
${data.goldRateApplied != null ? `Lom Kursi: ${data.goldRateApplied.toLocaleString()} UZS/g` : ""}
${data.cashEquivalentGrams != null && data.cashEquivalentGrams > 0 ? `Naqd Ekvivalenti: ${data.cashEquivalentGrams.toFixed(4)} g` : ""}
${data.usdAmount != null && data.usdAmount > 0 ? `To'langan USD: $${data.usdAmount.toLocaleString()} USD (Kurs: ${data.usdRateApplied?.toLocaleString()} UZS)` : ""}
${data.usdEquivalentGrams != null && data.usdEquivalentGrams > 0 ? `USD Ekvivalenti: ${data.usdEquivalentGrams.toFixed(4)} g` : ""}
${data.totalSettledGrams != null ? `Jami Qaytarilgan: ${data.totalSettledGrams.toFixed(4)} g` : ""}
${data.previousDebtGrams != null ? `Avvalgi Qarz: ${data.previousDebtGrams.toFixed(4)} g` : ""}
${data.advanceAppliedGrams != null && data.advanceAppliedGrams > 0 ? `Qoplangan Avans: -${data.advanceAppliedGrams.toFixed(4)} g` : ""}
${data.remainingDebtGrams != null ? `Qolgan Qarz: ${data.remainingDebtGrams.toFixed(4)} g` : ""}
${data.advanceGoldGrams != null && data.advanceGoldGrams > 0 ? `Ortiqcha Avans (Balans): ${data.advanceGoldGrams.toFixed(4)} g` : ""}
----------------------------------------
Izoh: ${data.notes || "—"}
========================================
JewelryFlow ERP — Rasmiy Hisob-Kitob Cheki
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full border border-amber-200 overflow-hidden text-slate-800 my-8">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-amber-800 p-6 text-white text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg"
          >
            ✕
          </button>
          <div className="text-xs uppercase tracking-widest text-amber-200 font-semibold mb-1">
            Goldia Jewelry Factory
          </div>
          <h2 className="text-xl font-black">{data.title}</h2>
          <div className="text-xs opacity-90 mt-1">
            № <span className="font-mono font-bold tracking-wider">{data.receiptNo}</span> • {data.date}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm divide-y divide-slate-100">
          {/* Parties */}
          <div className="space-y-2 pt-1">
            {data.sellerName && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Sotuvchi / Mas&apos;ul:</span>
                <span className="font-semibold text-slate-800">{data.sellerName}</span>
              </div>
            )}
            {data.customerName && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Mijoz:</span>
                <div className="text-right">
                  <div className="font-semibold text-slate-800">{data.customerName}</div>
                  {data.customerCode && (
                    <span className="inline-block bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-mono">
                      {data.customerCode}
                    </span>
                  )}
                  {data.customerPhone && (
                    <span className="text-slate-500 text-[11px] ml-2">{data.customerPhone}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Product / Base Gold Info */}
          {(data.itemName || data.baseWeightGrams != null) && (
            <div className="pt-3 space-y-2">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Mahsulot va Asl Vazn
              </div>
              {data.itemName && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Mahsulot:</span>
                  <span className="font-bold text-slate-900">{data.itemName}</span>
                </div>
              )}
              {data.baseWeightGrams != null && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Asl vazn (Gross):</span>
                  <span className="font-mono font-bold text-slate-900">
                    {data.baseWeightGrams.toFixed(4)} g{" "}
                    <span className="text-xs text-amber-700">({data.purity || 585} proba)</span>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Markups & Calculations */}
          {(data.clientMarkupPct != null || data.factoryMarkupPct != null) && (
            <div className="pt-3 space-y-2">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Ustama va Hisoblangan Oltin
              </div>
              {data.clientMarkupPct != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Mijoz ustamasi:</span>
                  <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                    +{data.clientMarkupPct}%
                  </span>
                </div>
              )}
              {data.clientGoldDueGrams != null && (
                <div className="flex justify-between bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                  <span className="font-bold text-amber-900">Mahsulot Oltin Qiymati:</span>
                  <span className="font-mono font-black text-amber-950 text-base">
                    {data.clientGoldDueGrams.toFixed(4)} g
                  </span>
                </div>
              )}
              {data.factoryMarkupPct != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Zavod ustamasi:</span>
                  <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                    +{data.factoryMarkupPct}%
                  </span>
                </div>
              )}
              {data.factoryGoldDueGrams != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">Zavod oldidagi majburiyat:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {data.factoryGoldDueGrams.toFixed(4)} g
                  </span>
                </div>
              )}
              {data.markupSpreadGrams != null && (
                <div className="flex justify-between text-xs text-slate-500 italic">
                  <span>Hisob-kitob farqi (Spread):</span>
                  <span className="font-mono">+{data.markupSpreadGrams.toFixed(4)} g</span>
                </div>
              )}
            </div>
          )}

          {/* Settlement / Payments */}
          {(data.totalSettledGrams != null || data.scrapWeightGrams != null || data.cashAmount != null) && (
            <div className="pt-3 space-y-2">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                To&apos;lov va Tushum Tafsiloti
              </div>
              {data.scrapWeightGrams != null && data.scrapWeightGrams > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Topshirilgan lom oltin:</span>
                  <span className="font-mono font-bold text-amber-700">
                    {data.scrapWeightGrams.toFixed(4)} g{" "}
                    <span className="text-xs text-slate-500">({data.scrapPurity || 585} proba)</span>
                  </span>
                </div>
              )}
              {data.cashAmount != null && data.cashAmount > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Topshirilgan naqd pul:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {data.cashAmount.toLocaleString()} UZS
                    </span>
                  </div>
                  {data.goldRateApplied != null && (
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Qo&apos;llanilgan lom kursi:</span>
                      <span className="font-mono">{data.goldRateApplied.toLocaleString()} UZS/g</span>
                    </div>
                  )}
                  {data.cashEquivalentGrams != null && (
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Naqdning lom ekvivalenti:</span>
                      <span className="font-mono font-semibold text-emerald-800">
                        = {data.cashEquivalentGrams.toFixed(4)} g lom
                      </span>
                    </div>
                  )}
                </div>
              )}
              {data.usdAmount != null && data.usdAmount > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Topshirilgan valyuta (USD):</span>
                    <span className="font-mono font-bold text-blue-700">
                      ${data.usdAmount.toLocaleString()} USD
                    </span>
                  </div>
                  {data.usdRateApplied != null && (
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>USD kursi:</span>
                      <span className="font-mono">{data.usdRateApplied.toLocaleString()} UZS/$</span>
                    </div>
                  )}
                  {data.usdEquivalentGrams != null && (
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>USD ning lom ekvivalenti:</span>
                      <span className="font-mono font-semibold text-blue-800">
                        = {data.usdEquivalentGrams.toFixed(4)} g lom
                      </span>
                    </div>
                  )}
                </div>
              )}
              {data.totalSettledGrams != null && (
                <div className="flex justify-between bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                  <span className="font-bold text-emerald-950">Jami Yopilgan Oltin:</span>
                  <span className="font-mono font-black text-emerald-950 text-base">
                    {data.totalSettledGrams.toFixed(4)} g
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Running Balance */}
          {(data.previousDebtGrams != null || data.remainingDebtGrams != null || data.advanceGoldGrams != null) && (
            <div className="pt-3 space-y-1.5 text-xs">
              {data.previousDebtGrams != null && (
                <div className="flex justify-between text-slate-500">
                  <span>Avvalgi qarz:</span>
                  <span className="font-mono">{data.previousDebtGrams.toFixed(4)} g</span>
                </div>
              )}
              {data.advanceAppliedGrams != null && data.advanceAppliedGrams > 0 && (
                <div className="flex justify-between font-bold text-emerald-700 bg-emerald-50 p-2 rounded-lg">
                  <span>Qoplangan Avans:</span>
                  <span className="font-mono text-sm">-{data.advanceAppliedGrams.toFixed(4)} g</span>
                </div>
              )}
              {data.remainingDebtGrams != null && (
                <div className="flex justify-between font-bold text-slate-800">
                  <span>Hozirgi qolgan qarz:</span>
                  <span className={`font-mono text-sm ${data.remainingDebtGrams > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {data.remainingDebtGrams.toFixed(4)} g
                  </span>
                </div>
              )}
              {data.advanceGoldGrams != null && data.advanceGoldGrams > 0 && (
                <div className="flex justify-between font-bold text-blue-700 bg-blue-50 p-2 rounded-lg">
                  <span>Mijozning ortiqcha balansi (Avans):</span>
                  <span className="font-mono text-sm">+{data.advanceGoldGrams.toFixed(4)} g</span>
                </div>
              )}
            </div>
          )}

          {data.notes && (
            <div className="pt-3 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Izoh: </span>
              {data.notes}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={handleCopy}
            className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1.5 transition"
          >
            {copied ? "✅ Nusxa olindi!" : "📋 Nusxa olish"}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-800 hover:bg-slate-900 text-white flex items-center gap-1.5 transition"
          >
            🖨️ Chop etish
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white transition"
          >
            Tayyor (Yopish)
          </button>
        </div>
      </div>
    </div>
  );
}
