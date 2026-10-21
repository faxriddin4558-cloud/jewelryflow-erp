"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function ConsignmentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>📟</span> Scanner 564 Konsignatsiya Tarqatish
          </h1>
          <p className="text-xs text-slate-400">
            Model QR kodini va BarTender vazn shtrix-kodlarini skaner qilib sotuvchiga tezkor topshirish.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="scanner_consign" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
