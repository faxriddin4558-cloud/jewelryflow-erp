"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function FinancialReportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>📑</span> Moliyaviy Hisobotlar & Rekonsilyatsiya Tarixi
          </h1>
          <p className="text-xs text-slate-400">
            Tranzaksiyalar auditi, qarzlar dinamikasi, CSV/Excel eksport va moliyaviy muvozanat.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="history" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
