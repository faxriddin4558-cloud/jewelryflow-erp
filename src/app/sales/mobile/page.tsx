"use client";

import Link from "next/link";
import { SellerMobileWorkspace } from "@/components/sales/SellerMobileWorkspace";

export default function SalesMobilePage() {
  return (
    <div className="p-3 md:p-6 space-y-4 text-slate-800 max-w-2xl mx-auto">
      {/* Top quick navigation */}
      <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-slate-200 shadow-sm text-xs">
        <Link href="/sales" className="text-blue-600 font-bold hover:underline">
          ← Asosiy Savdo
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/sales/director"
            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-xl border border-amber-200 transition text-[11px]"
          >
            👑 Direktor
          </Link>
        </div>
      </div>

      <SellerMobileWorkspace />
    </div>
  );
}
