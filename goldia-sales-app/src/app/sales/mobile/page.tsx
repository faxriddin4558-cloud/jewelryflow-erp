"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SellerMobileWorkspace } from "@/components/sales/SellerMobileWorkspace";
import { RBAC, type ErpUser } from "@/lib/erp-engine";

export default function SalesMobilePage() {
  const [currentUser, setCurrentUser] = useState<ErpUser>(() => RBAC.getCurrentUser());
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    return RBAC.subscribe((u) => setCurrentUser(u));
  }, []);

  const isPrivileged =
    isMounted &&
    Boolean(
      currentUser.role &&
        ["director", "admin", "production manager", "boshqaruvchi"].includes(
          currentUser.role.toLowerCase()
        )
    );

  return (
    <div className="p-3 md:p-6 space-y-4 text-slate-800 max-w-2xl mx-auto">
      {/* Top quick navigation */}
      <div className="flex items-center justify-between bg-slate-900 text-white p-3 rounded-2xl border border-slate-800 shadow-md text-xs">
        <Link href="/sales/app" className="text-amber-400 font-bold hover:underline flex items-center gap-1">
          ← Asosiy Savdo
        </Link>
        {isPrivileged && (
          <div className="flex items-center gap-2">
            <Link
              href="/sales/director"
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl transition text-xs shadow-sm"
            >
              👑 Direktor Paneli
            </Link>
          </div>
        )}
      </div>

      <SellerMobileWorkspace />
    </div>
  );
}
