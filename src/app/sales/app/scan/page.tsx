"use client";

import Link from "next/link";
import { SellerMobileWorkspace } from "@/components/sales/SellerMobileWorkspace";

// Skaner Savdo: barcode scan sale, own pieces (with return to manager) and own batches.
// Weight-based sales are recorded per customer in "Mijozlar va Nasiya" (customer -> Savdo).
export default function ScanSalePage() {
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-900 border border-slate-800 p-4">
        <h1 className="text-lg font-black text-white">⚡ Skaner Savdo</h1>
        <Link href="/sales/app/customers" className="text-xs font-bold text-amber-400">⚖️ Vazn bo&apos;yicha savdo → Mijozlar</Link>
      </div>
      <SellerMobileWorkspace tabs={["scan_sale", "pieces", "stock"]} initialTab="scan_sale" compact />
    </div>
  );
}
