"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function PurchasesPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>🪙</span> Naqd Pulga Oltin Xarid (&quot;Tovar Olish&quot;)
          </h1>
          <p className="text-xs text-slate-400">
            Sheets &quot;Tovar olish&quot; pariteti: Naqd pulga bozor/ta&apos;minotchidan oltin sotib olish va kassa hisob-kitobi.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="vault" vaultSection="purchases" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
