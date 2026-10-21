"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>🛍️</span> Mijozlar va Nasiya Daftari (3-Zanjir)
          </h1>
          <p className="text-xs text-slate-400">
            Mijozlarga 12% ustama bilan yozilgan nasiyalar, qarz qoldiqlari va lom/naqd to&apos;lovlar.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="clients" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
