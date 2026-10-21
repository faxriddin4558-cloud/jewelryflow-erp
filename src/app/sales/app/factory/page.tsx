"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function FactoryLedgerPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>🏭</span> Zavod Bilan Hisob-Kitob Daftari
          </h1>
          <p className="text-xs text-slate-400">
            Sheets &quot;Zavod bilan&quot; pariteti: Zavoddan tovar kirimi (585g + 8%) va zavodga qaytarilgan sof oltin.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="factory" factorySection="all" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
