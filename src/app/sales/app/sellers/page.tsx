"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";
import { SellerRatesOverview } from "@/components/sales/SellerRatesCard";
import { OperationRateReview } from "@/components/sales/OperationRateReview";

// P0 (2026-11-18): the individual seller cards come first (a manager on a phone sees every seller's obligation, stock,
// LOM / UZS / USD and the receive button at once); the rate blocks follow as collapsible sections. Layout only.
export default function SellersPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-3 sm:p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
            <span>👥</span> Sotuvchilar Balansi & Bozor Qarzi (+/-)
          </h1>
          <p className="text-xs text-slate-400">
            Sotuvchilarning zavod oldidagi majburiyati, kassasidagi pullar/lom va imzolangan Bozor Qarzi.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="sellers" hideTopBanner={true} hideTabBar={true} />

      <details className="bg-slate-900 border border-slate-800 rounded-2xl" data-testid="sellers-rates-section">
        <summary className="cursor-pointer select-none p-3 sm:p-4 text-sm font-bold text-slate-200">Sotuvchilar kurslari</summary>
        <div className="p-2 sm:p-3 pt-0">
          <SellerRatesOverview />
        </div>
      </details>

      <details className="bg-slate-900 border border-slate-800 rounded-2xl" data-testid="sellers-rate-review-section">
        <summary className="cursor-pointer select-none p-3 sm:p-4 text-sm font-bold text-slate-200">Operatsiya kurslari tekshiruvi</summary>
        <div className="p-2 sm:p-3 pt-0">
          <OperationRateReview />
        </div>
      </details>
    </div>
  );
}
