"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DirectorSalesWorkspace } from "@/components/sales/DirectorSalesWorkspace";
import { useSessionUser } from "@/lib/use-session-user";
import { isSellerUiRole } from "@/lib/sales-role-access";

export default function SalesDirectorPage() {
  const router = useRouter();
  const user = useSessionUser();
  const isSeller = isSellerUiRole(user?.role);
  useEffect(() => {
    if (isSeller) router.replace("/sales/app?unauthorized=1");
  }, [isSeller, router]);
  // Mount the management workspace only for a known, non-seller session.
  if (!user || isSeller || !user.id) return null;

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
            href="/sales/app/scan"
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
