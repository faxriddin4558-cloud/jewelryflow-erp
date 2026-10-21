"use client";

import { useState } from "react";
import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function SettingsAndImportPage() {
  const [activeSubTab, setActiveSubTab] = useState<"presets" | "sheets_import">("presets");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800 gap-4">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>⚙️</span> Sozlamalar, Dinamik Foizlar & Google Sheets Import
          </h1>
          <p className="text-xs text-slate-400">
            Dinamik zavod/mijoz ustamalari boshqaruvi va Google Sheets jadvallarini tizimga import qilish.
          </p>
        </div>

        {/* Clean 2-tab segmented control for settings & import */}
        <div className="flex items-center gap-2 p-1.5 bg-slate-950 rounded-2xl border border-slate-800 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveSubTab("presets")}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeSubTab === "presets"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            ⚙️ Dinamik Ustama Foizlar
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("sheets_import")}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeSubTab === "sheets_import"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            📥 Sheets Import
          </button>
        </div>
      </div>

      <DirectorSalesWorkspace initialTab={activeSubTab} hideTopBanner={true} hideTabBar={true} />
    </div>
  );
}
