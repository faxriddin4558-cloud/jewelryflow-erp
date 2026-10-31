"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function BarTenderModelsPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>🏷️</span> BarTender Modellar & Doimiy QR Generator
          </h1>
          <p className="text-xs text-slate-400">
            Zargarlik modellari katalogi, fotosuratlar, etiketka parametrlari va chop etish uchun doimiy QR kodlar.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="models" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
