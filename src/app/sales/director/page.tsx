"use client";

import Link from "next/link";
import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function SalesDirectorPage() {
  return (
    <div className="p-4 md:p-8 space-y-6 text-slate-800 max-w-7xl mx-auto">
      {/* Top quick navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-xs">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <Link href="/sales" className="text-blue-600 hover:underline">
            ← Savdo Bosh Sahifasi
          </Link>
          <span className="text-slate-300">/</span>
          <span>Direktor Paneli</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/sales/mobile"
            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl border border-blue-200 transition flex items-center gap-1.5"
          >
            <span>📱</span> Sotuvchi Mobil Paneli
          </Link>
          <Link
            href="/sales"
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition"
          >
            🏪 Klassik Vitrina
          </Link>
        </div>
      </div>

      <DirectorSalesWorkspace />
    </div>
  );
}
