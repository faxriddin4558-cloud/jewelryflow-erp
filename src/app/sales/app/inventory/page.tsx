"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function ManagerInventoryPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>🏦</span> Boshqaruvchi Ombori: Fizik Donalar (JF-PIECE)
          </h1>
          <p className="text-xs text-slate-400">
            Menejer seyfi va sotuvchilar vitrinalaridagi har bir fizik buyum (JF-PIECE) va umumiy grammlar hisobi (Moliyaviy bozor qarzi uchun emas, fizik dona qoldiqlari uchun).
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="seller_stock" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
