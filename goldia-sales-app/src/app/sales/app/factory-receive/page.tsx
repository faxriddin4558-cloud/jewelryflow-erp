"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function FactoryReceivePage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>📥</span> Zavoddan Tovar Qabul Qilish
          </h1>
          <p className="text-xs text-slate-400">
            Zavod partiyasini qabul qilish: 100g 585 mahsulot 8% zavod ustamasi bilan 108g majburiyat hosil qiladi.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="factory" factorySection="receive" hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
