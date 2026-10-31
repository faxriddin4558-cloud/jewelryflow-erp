"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function ManagerInventoryPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>🏦</span> Boshqaruvchi Ombori: Fizik Mahsulotlar (585)
          </h1>
          <p className="text-xs text-slate-400">
            Menejer ombori va sotuvchilar vitrinalaridagi tayyor mahsulotlar hamda umumiy sof grammlar hisobi.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="seller_stock" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
