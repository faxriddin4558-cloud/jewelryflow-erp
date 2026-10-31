"use client";

import Link from "next/link";
import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";

export default function SalesDirectorPage() {
  return (
    <div className="p-4 md:p-8 space-y-6 text-slate-800 max-w-7xl mx-auto">
      {/* Top quick navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 text-white p-4 rounded-2xl border border-slate-800 shadow-md text-xs">
        <div className="flex items-center gap-2 font-bold text-white">
          <Link href="/sales" className="text-amber-400 hover:text-amber-300 font-bold hover:underline">
            ← Savdo Bosh Sahifasi
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-white font-black">Direktor Paneli</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/sales/mobile"
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm"
          >
            <span>📱</span> Sotuvchi Mobil Paneli
          </Link>
          <Link
            href="/sales"
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl transition border border-slate-700"
          >
            🏪 Klassik Vitrina
          </Link>
        </div>
      </div>

      <DirectorSalesWorkspace />
    </div>
  );
}
