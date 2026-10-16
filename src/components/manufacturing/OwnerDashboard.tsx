import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/shared/ui/card";
import {
  BarChart3,
  AlertTriangle,
  Layers,
  Activity,
  Cpu,
  Scale
} from "lucide-react";

export interface OwnerDashboardStats {
  activeBatches: number;
  overdueStages: number;
  machineLoadPercent: number;
  wipQuantityGrams: number;
  unresolvedGoldDiscrepancies: number;
  productionPerformanceScore: number;
}

export interface OwnerDashboardProps extends React.HTMLAttributes<HTMLDivElement> {
  stats: OwnerDashboardStats;
  isLoading?: boolean;
}

export function OwnerDashboard({ stats, isLoading, className, ...props }: OwnerDashboardProps) {
  if (isLoading) {
    return (
      <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", className)} {...props}>
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="animate-pulse h-32"></Card>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6", className)} {...props}>
      <Card className="border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Active Batches
          </CardTitle>
          <Layers className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.activeBatches}</div>
          <p className="text-xs text-muted-foreground mt-1">Currently in production</p>
        </CardContent>
      </Card>

      <Card className="border-red-100 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Overdue Stages
          </CardTitle>
          <AlertTriangle className={cn("h-4 w-4", stats.overdueStages > 0 ? "text-red-500" : "text-muted-foreground")} />
        </CardHeader>
        <CardContent>
          <div className={cn("text-3xl font-bold", stats.overdueStages > 0 && "text-red-600 dark:text-red-400")}>
            {stats.overdueStages}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Require immediate attention</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Machine Load
          </CardTitle>
          <Cpu className="h-4 w-4 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.machineLoadPercent}%</div>
          <div className="w-full bg-muted rounded-full h-2.5 mt-3">
            <div
              className={cn("h-2.5 rounded-full", stats.machineLoadPercent > 80 ? "bg-red-500" : stats.machineLoadPercent > 60 ? "bg-orange-500" : "bg-green-500")}
              style={{ width: `${Math.min(100, stats.machineLoadPercent)}%` }}
            ></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            WIP Quantity
          </CardTitle>
          <BarChart3 className="h-4 w-4 text-emerald-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold font-mono">
            {stats.wipQuantityGrams.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-lg font-sans opacity-70">g</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Total gold weight in process</p>
        </CardContent>
      </Card>

      <Card className="border-orange-100 dark:border-orange-900 bg-orange-50/50 dark:bg-orange-950/20">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Gold Discrepancies
          </CardTitle>
          <Scale className={cn("h-4 w-4", stats.unresolvedGoldDiscrepancies > 0 ? "text-orange-500" : "text-muted-foreground")} />
        </CardHeader>
        <CardContent>
          <div className={cn("text-3xl font-bold", stats.unresolvedGoldDiscrepancies > 0 && "text-orange-600 dark:text-orange-400")}>
            {stats.unresolvedGoldDiscrepancies}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Unresolved handover flags</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Production Perf
          </CardTitle>
          <Activity className="h-4 w-4 text-indigo-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
            {stats.productionPerformanceScore.toFixed(1)} <span className="text-lg opacity-70">/ 10</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Aggregate efficiency score</p>
        </CardContent>
      </Card>
    </div>
  );
}
