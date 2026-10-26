"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/erp-engine";
import { formatScreenGrams, formatScreenUZS } from "@/lib/barcode-scanner-engine";

export interface SellerReconciliationData {
  seller_id: string;
  seller_name: string;
  generated_at: string;
  section_a: {
    item_count: number;
    original_grams: number;
    seller_markup_pct: number;
    seller_markup_obligation_grams: number;
    legacy_customer_debt_assigned_g?: number;
  };
  section_b: {
    item_count: number;
    original_grams: number;
    seller_markup_equivalent_grams: number;
  };
  section_c: {
    item_count: number;
    original_grams: number;
    seller_markup_equivalent_grams: number;
  };
  section_d: {
    customer_count?: number;
    customer_markup_obligation_grams: number;
    scrap_collected_grams: number;
    cash_collected_uzs: number;
    cash_equivalent_grams: number;
    outstanding_customer_debt_grams: number;
  };
  section_e: {
    scrap_grams: number;
    cash_uzs: number;
  };
  section_f: {
    settlements_scrap_grams: number;
    settlements_cash_uzs: number;
    settlements_cash_equivalent_grams: number;
    returned_unsold_items_count: number;
    returned_unsold_original_grams: number;
    returned_unsold_seller_obligation_grams: number;
  };
  section_g: {
    total_goods_obligation_grams?: number;
    total_deductions_settled_and_returned_grams?: number;
    seller_owes_manager_grams: number;
    manager_owes_seller_grams: number;
    bozor_qarzi_signed_grams: number;
    discrepancy_grams: number;
    is_reconciled: boolean;
  };
}

interface Props {
  sellerId: string;
  sellerName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function SellerReconciliationModal({ sellerId, sellerName, isOpen, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SellerReconciliationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !sellerId) return;

    const fetchReconciliation = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: res, error: err } = await supabase.rpc("rpc_get_seller_reconciliation_statement", {
          p_seller_id: sellerId,
        });

        if (err) throw err;
        setData(res as unknown as SellerReconciliationData);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };

    void fetchReconciliation();
  }, [isOpen, sellerId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-4xl w-full p-6 text-white space-y-6 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="text-xs uppercase font-extrabold tracking-widest text-amber-400">
              7-Bosqichli Rekonsilyatsiya Bayonnomasi
            </div>
            <h2 className="text-xl font-black text-white mt-0.5">
              {sellerName} — To&apos;liq Balans va Bozor Qarzi (A - G)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-sm transition"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div className="py-16 text-center text-slate-400 text-xs">
            Rekonsilyatsiya bayonnomasi hisoblanmoqda...
          </div>
        )}

        {error && (
          <div className="p-4 bg-rose-950/80 border border-rose-800 rounded-2xl text-rose-200 text-xs font-bold">
            Xatolik: {error}
          </div>
        )}

        {!loading && data && (
          <div className="space-y-4 text-xs">
            {/* Status Banner */}
            <div
              className={`p-4 rounded-2xl border flex items-center justify-between ${
                data.section_g.is_reconciled
                  ? "bg-emerald-950/60 border-emerald-700 text-emerald-200"
                  : "bg-rose-950/60 border-rose-700 text-rose-200"
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                <span className="text-lg">{data.section_g.is_reconciled ? "✓" : "⚠️"}</span>
                <div>
                  <div>
                    {data.section_g.is_reconciled
                      ? "Barcha moddiy va moliyaviy hisoblar 100% mutanosib (0.00 g farq)"
                      : `DIQQAT: Hisob-kitobda ${formatScreenGrams(data.section_g.discrepancy_grams, 2)} nomutanosiblik aniqlandi!`}
                  </div>
                  <div className="text-[11px] font-normal text-[#CBD5E1] mt-0.5">
                    Asl konsignatsiyalar, qaytarilgan tovarlar va topshirilgan to&apos;lovlar bo&apos;yicha tekshirildi.
                  </div>
                </div>
              </div>
              <div className="text-right font-mono font-black text-base">
                {data.section_g.bozor_qarzi_signed_grams < 0 ? (
                  <span className="text-rose-400">
                    {formatScreenGrams(data.section_g.bozor_qarzi_signed_grams)}
                  </span>
                ) : (
                  <span className="text-emerald-400">
                    +{formatScreenGrams(data.section_g.bozor_qarzi_signed_grams)}
                  </span>
                )}
              </div>
            </div>

            {/* SECTIONS A through G */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* SECTION A: RECEIVED FROM MANAGER */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
                <div className="font-bold text-amber-300 flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span>A. Boshqaruvchidan Qabul Qilingan Tovar</span>
                  <span className="text-[10px] text-slate-500 font-normal">Konsignatsiya</span>
                </div>
                <div className="space-y-1 font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span>Jami qabul qilingan asl vazn:</span>
                    <span className="font-bold text-white">{formatScreenGrams(data.section_a.original_grams)}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Sotuvchi majburiyati (12% ustama):</span>
                    <span className="font-bold text-amber-400">{formatScreenGrams(data.section_a.seller_markup_obligation_grams)}</span>
                  </div>
                  {Number(data.section_a.legacy_customer_debt_assigned_g || 0) > 0 && (
                    <div className="flex justify-between text-cyan-300 text-[11px]">
                      <span>Biriktirilgan eski mijoz qarzi:</span>
                      <span className="font-bold">+{formatScreenGrams(data.section_a.legacy_customer_debt_assigned_g)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-400 text-[11px]">
                    <span>Jami donalar soni:</span>
                    <span>{data.section_a.item_count} dona</span>
                  </div>
                </div>
              </div>

              {/* SECTION B: GOODS UNSOLD */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
                <div className="font-bold text-emerald-400 flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span>B. Sotilmagan Tovarlar (Sotuvchi Javonida)</span>
                  <span className="text-[10px] text-slate-500 font-normal">Ombor qoldig&apos;i</span>
                </div>
                <div className="space-y-1 font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span>Sotilmagan asl vazn:</span>
                    <span className="font-bold text-white">{formatScreenGrams(data.section_b.original_grams)}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Majburiyat ekvivalenti (12%):</span>
                    <span className="font-bold text-emerald-400">{formatScreenGrams(data.section_b.seller_markup_equivalent_grams)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400 text-[11px]">
                    <span>Qoldiq donalar soni:</span>
                    <span>{data.section_b.item_count} dona</span>
                  </div>
                </div>
              </div>

              {/* SECTION C: GOODS SOLD TO CUSTOMERS */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
                <div className="font-bold text-cyan-300 flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span>C. Mijozlarga Sotilgan Tovarlar</span>
                  <span className="text-[10px] text-slate-500 font-normal">Nasiya / Savdo</span>
                </div>
                <div className="space-y-1 font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span>Sotilgan asl vazn:</span>
                    <span className="font-bold text-white">{formatScreenGrams(data.section_c.original_grams)}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Menejer oldidagi majburiyat (12%):</span>
                    <span className="font-bold text-cyan-400">{formatScreenGrams(data.section_c.seller_markup_equivalent_grams)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400 text-[11px]">
                    <span>Sotilgan donalar soni:</span>
                    <span>{data.section_c.item_count} dona</span>
                  </div>
                </div>
              </div>

              {/* SECTION D: CUSTOMER RECEIVABLES */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
                <div className="font-bold text-rose-300 flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span>D. Mijozlar Qarzdorligi (Nasiya)</span>
                  <span className="text-[10px] text-slate-500 font-normal">Mijoz hisobi</span>
                </div>
                <div className="space-y-1 font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span>Mijozga yozilgan qarz (12-15%):</span>
                    <span className="font-bold text-rose-300">{formatScreenGrams(data.section_d.customer_markup_obligation_grams)}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Mijozlardan yig&apos;ilgan to&apos;lov:</span>
                    <span className="font-bold text-emerald-400">
                      {formatScreenGrams(data.section_d.scrap_collected_grams + data.section_d.cash_equivalent_grams)} eq
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Qoldiq mijozlar qarzi:</span>
                    <span className="font-black text-rose-400">{formatScreenGrams(data.section_d.outstanding_customer_debt_grams)}</span>
                  </div>
                </div>
              </div>

              {/* SECTION E: SELLER HOLDINGS */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
                <div className="font-bold text-amber-400 flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span>E. Sotuvchi G&apos;aznasi (Holdings)</span>
                  <span className="text-[10px] text-slate-500 font-normal">Kassada mavjud</span>
                </div>
                <div className="space-y-1 font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span>Qo&apos;lidagi lom oltin:</span>
                    <span className="font-bold text-amber-300">{formatScreenGrams(data.section_e.scrap_grams)}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Qo&apos;lidagi naqd pul:</span>
                    <span className="font-bold text-emerald-400">{formatScreenUZS(data.section_e.cash_uzs)}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Mijoz to&apos;lagan pul/lom menejerga topshirilmaguncha bozor qarzini kamaytirmaydi.
                  </div>
                </div>
              </div>

              {/* SECTION F: SETTLEMENTS & RETURNS */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
                <div className="font-bold text-indigo-300 flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span>F. Menejerga Topshirilgan To&apos;lov & Qaytgan Tovar</span>
                  <span className="text-[10px] text-slate-500 font-normal">Hisobdan chiqarish</span>
                </div>
                <div className="space-y-1 font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span>Topshirilgan lom va pul eq:</span>
                    <span className="font-bold text-emerald-400">
                      {formatScreenGrams(data.section_f.settlements_scrap_grams + data.section_f.settlements_cash_equivalent_grams)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Qaytarilgan sotilmagan tovar:</span>
                    <span className="font-bold text-amber-400">
                      {data.section_f.returned_unsold_items_count} dona ({formatScreenGrams(data.section_f.returned_unsold_original_grams)})
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400 text-[11px]">
                    <span>Qaytgan tovar majburiyat qiymati:</span>
                    <span>-{formatScreenGrams(data.section_f.returned_unsold_seller_obligation_grams)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION G: SIGNED BOZOR QARZI SUMMARY */}
            <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h3 className="font-black text-amber-300 text-sm">
                  G. Joriy Imzolangan Bozor Qarzi (Formula Tahlili)
                </h3>
                <span className="text-xs font-mono font-bold text-slate-400">
                  Formula: Majburiyat (A) - Qaytgan tovar (F) - Topshirilgan to&apos;lov (F)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center font-mono">
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <div className="text-[11px] text-slate-400 font-sans">Sof Sotuvchi Majburiyati:</div>
                  <div className="text-base font-bold text-amber-400 mt-1">
                    {formatScreenGrams(data.section_g.seller_owes_manager_grams)}
                  </div>
                </div>

                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <div className="text-[11px] text-slate-400 font-sans">Boshqaruvchi Haqdorligi:</div>
                  <div className="text-base font-bold text-slate-300 mt-1">
                    {formatScreenGrams(data.section_g.manager_owes_seller_grams)}
                  </div>
                </div>

                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <div className="text-[11px] text-slate-400 font-sans">Imzolangan Bozor Qarzi (+/-):</div>
                  <div className="text-lg font-black font-mono mt-1">
                    {data.section_g.bozor_qarzi_signed_grams < 0 ? (
                      <span className="text-rose-400">
                        {formatScreenGrams(data.section_g.bozor_qarzi_signed_grams)}
                      </span>
                    ) : (
                      <span className="text-emerald-400">
                        +{formatScreenGrams(data.section_g.bozor_qarzi_signed_grams)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition"
          >
            Yopish
          </button>
        </div>
      </div>
    </div>
  );
}
