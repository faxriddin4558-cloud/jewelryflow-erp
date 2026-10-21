"use client";

import Link from "next/link";
import { SellerMobileWorkspace } from "@/components/sales/SellerMobileWorkspace";

export default function SalesMobilePage() {
  return (
    <div className="p-3 md:p-6 space-y-4 text-slate-800 max-w-2xl mx-auto">
      {/* Top quick navigation */}
      <div className="flex items-center justify-between bg-slate-900 text-white p-3 rounded-2xl border border-slate-800 shadow-md text-xs">
        <Link href="/sales" className="text-amber-400 font-bold hover:underline flex items-center gap-1">
          ← Asosiy Savdo
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/sales/director"
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl transition text-xs shadow-sm"
          >
            👑 Direktor Paneli
          </Link>
        </div>
      </div>

      <SellerMobileWorkspace />
    </div>
  );
}
