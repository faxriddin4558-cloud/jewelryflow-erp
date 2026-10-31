"use client";

import { useState } from "react";
import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";
import { TestCleanupSection } from "@/components/sales/TestCleanupSection";

export default function SettingsAndImportPage() {
  const [activeSubTab, setActiveSubTab] = useState<"presets" | "sheets_import" | "cleanup">("presets");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800 gap-4">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>⚙️</span> Sozlamalar & Boshqaruv
          </h1>
          <p className="text-xs text-slate-400">
            Dinamik ustamalar boshqaruvi, Google Sheets importi va sinov ma&apos;lumotlarini tozalash.
          </p>
        </div>

        {/* 3-tab segmented control */}
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
            ⚙️ Dinamik Foizlar
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
          <button
            type="button"
            onClick={() => setActiveSubTab("cleanup")}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeSubTab === "cleanup"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            🧹 Sinov Tozalash
          </button>
        </div>
      </div>

      {activeSubTab === "cleanup" ? (
        <TestCleanupSection />
      ) : (
        <DirectorSalesWorkspace initialTab={activeSubTab} hideTopBanner={true} hideTabBar={true} />
      )}
    </div>
  );
}
