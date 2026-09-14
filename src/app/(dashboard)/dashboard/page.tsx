import { DashboardSummaryCards } from "@/modules/manufacturing/presentation/components/dashboard-summary-cards";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Factory Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Live production KPIs across every batch, order, and department.
        </p>
      </div>
      <DashboardSummaryCards />
    </div>
  );
}
