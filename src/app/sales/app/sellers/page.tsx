"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";
import { SellerRatesOverview } from "@/components/sales/SellerRatesCard";
import { OperationRateReview } from "@/components/sales/OperationRateReview";

export default function SellersPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>👥</span> Sotuvchilar Balansi & Bozor Qarzi (+/-)
          </h1>
          <p className="text-xs text-slate-400">
            Sotuvchilarning zavod oldidagi majburiyati, kassasidagi pullar/lom va imzolangan Bozor Qarzi.
          </p>
        </div>
      </div>

      <SellerRatesOverview />

      <OperationRateReview />

      <DirectorSalesWorkspace initialTab="sellers" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
