"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function RefiningPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>⚗️</span> Afinaj & Lom Pateriya
          </h1>
          <p className="text-xs text-slate-400">
            Sheets &quot;Lom pateriya&quot; pariteti: Yig&apos;ilgan lomni eritish, 995 sof oltin olish va yo&apos;qotish (pateriya) hisobi.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="vault" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
