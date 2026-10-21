"use client";

import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function SettingsAndImportPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>⚙️</span> Sozlamalar, Dinamik Foizlar & Google Sheets Import
          </h1>
          <p className="text-xs text-slate-400">
            Dinamik zavod/mijoz ustamalari boshqaruvi va Google Sheets jadvallarini tizimga import qilish.
          </p>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab="presets" hideTopBanner={true} hideTabBar={false} />
    </div>
  );
}
