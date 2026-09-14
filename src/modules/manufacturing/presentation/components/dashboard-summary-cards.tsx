"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { useFactoryDashboardSummary } from "../hooks/use-factory-dashboard-summary";

interface SummaryCardDef {
  label: string;
  value: (s: NonNullable<ReturnType<typeof useFactoryDashboardSummary>["data"]>) => string;
  accentClassName: string;
}

const CARDS: SummaryCardDef[] = [
  {
    label: "In Progress",
    value: (s) => String(s.batches_in_progress),
    accentClassName: "text-[hsl(var(--status-progress))]",
  },
  {
    label: "Delayed",
    value: (s) => String(s.batches_delayed),
    accentClassName: "text-[hsl(var(--status-delayed))]",
  },
  {
    label: "On Hold",
    value: (s) => String(s.batches_on_hold),
    accentClassName: "text-[hsl(var(--status-hold))]",
  },
  {
    label: "Pending",
    value: (s) => String(s.batches_pending),
    accentClassName: "text-[hsl(var(--status-pending))]",
  },
  {
    label: "Completed Today",
    value: (s) => String(s.batches_completed_today),
    accentClassName: "text-[hsl(var(--status-completed))]",
  },
  {
    label: "Active Orders",
    value: (s) => String(s.active_orders),
    accentClassName: "text-foreground",
  },
  {
    label: "QC Failures Today",
    value: (s) => String(s.qc_failures_today),
    accentClassName: "text-[hsl(var(--status-delayed))]",
  },
  {
    label: "Gold On Hand (g)",
    value: (s) => s.gold_on_hand_grams.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    accentClassName: "text-foreground",
  },
];

/** Top-level KPI row for the Factory Dashboard, backed by the
 * single-row `factory_dashboard_summary` view (migration 013). */
export function DashboardSummaryCards() {
  const { data, isLoading, isError } = useFactoryDashboardSummary();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load factory dashboard summary.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {CARDS.map((card) => (
        <Card key={card.label}>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">{card.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${card.accentClassName}`}>{card.value(data)}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
