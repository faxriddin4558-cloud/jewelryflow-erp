"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CustomerLedgerAndSheetsSection } from "@/components/sales/CustomerLedgerAndSheetsSection";
import { SellerMobileWorkspace, type SellerWorkspaceTab } from "@/components/sales/SellerMobileWorkspace";
import { useSessionUser } from "@/lib/use-session-user";
import { isSellerUiRole } from "@/lib/sales-role-access";

// Mijozlar va Nasiya. Management: the customer book as before. Seller: the own customer book (with weight
// sales, history and reversals) plus credit sale, payment collection, debts and new customer.
const SELLER_TABS: { key: "book" | SellerWorkspaceTab; label: string }[] = [
  { key: "book", label: "📒 Mijozlar daftari" },
  { key: "settle", label: "💰 To'lov olish" },
  { key: "sale", label: "🏷️ Nasiya savdo" },
  { key: "debts", label: "📋 Qarzlar" },
  { key: "customer", label: "➕ Yangi mijoz" },
];

function CustomersContent() {
  const router = useRouter();
  const params = useSearchParams();
  const user = useSessionUser();
  const isSeller = isSellerUiRole(user?.role);
  const requested = params.get("tab");
  const tab = SELLER_TABS.some((t) => t.key === requested) ? (requested as (typeof SELLER_TABS)[number]["key"]) : "book";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-white">Mijozlar va Nasiya</h1>
      {isSeller && (
        <div className="flex gap-2 overflow-x-auto pb-1 text-xs font-bold" role="tablist">
          {SELLER_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => router.replace(t.key === "book" ? "/sales/app/customers" : `/sales/app/customers?tab=${t.key}`)}
              className={`shrink-0 px-3 py-2.5 rounded-xl border ${tab === t.key ? "bg-amber-500 text-slate-950 border-amber-500" : "bg-slate-900 text-slate-200 border-slate-700"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {!user ? null : !isSeller || tab === "book" ? (
        <CustomerLedgerAndSheetsSection />
      ) : (
        <SellerMobileWorkspace key={tab} tabs={[tab]} initialTab={tab} compact />
      )}
    </div>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <CustomersContent />
    </Suspense>
  );
}
