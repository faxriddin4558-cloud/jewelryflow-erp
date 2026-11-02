"use client";

import { MarkupDifferenceCard } from "@/components/sales/MarkupDifferenceCard";

// Ustama Farqi: for a seller the report is limited to the seller's own sales by the server.
export default function MarkupPage() {
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <h1 className="text-lg font-black text-white rounded-2xl bg-slate-900 border border-slate-800 p-4">📈 Ustama Farqi</h1>
      <MarkupDifferenceCard />
    </div>
  );
}
