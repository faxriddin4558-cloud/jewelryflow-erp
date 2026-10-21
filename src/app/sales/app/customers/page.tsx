import { CustomerLedgerAndSheetsSection } from "@/components/sales/CustomerLedgerAndSheetsSection";

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black text-white">Mijozlar va Nasiya Daftari</h1>
      <CustomerLedgerAndSheetsSection />
    </div>
  );
}
