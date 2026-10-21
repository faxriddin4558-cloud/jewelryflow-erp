"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function HandoversPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>🚚</span> Zavodga Oltin Topshirish
          </h1>
          <p className="text-xs text-slate-400">
            Afinaj qilingan yoki xarid qilingan oltinni zavodga topshirish va zavod qarzini kamaytirish.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="factory" factorySection="handover" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
