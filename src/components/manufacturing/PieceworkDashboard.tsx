import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Coins, CheckCircle2, Clock, History, AlertCircle } from "lucide-react";
import type { EmploymentStatus } from "@/shared/types/database.types";

export interface PieceworkStats {
  acceptedPieces: number;
  pendingPieces: number;
  earnedAmount: number;
  currency: string;
}

export interface AdjustmentRecord {
  id: string;
  date: string;
  amount: number;
  reason: string;
  type: "bonus" | "penalty" | "correction";
}

export interface PieceworkDashboardProps extends React.HTMLAttributes<HTMLDivElement> {
  employeeName: string;
  employmentStatus: EmploymentStatus;
  stats: PieceworkStats;
  adjustments: AdjustmentRecord[];
  isLoading?: boolean;
}

export function PieceworkDashboard({
  employeeName,
  employmentStatus,
  stats,
  adjustments,
  isLoading,
  className,
  ...props
}: PieceworkDashboardProps) {
  if (isLoading) {
    return (
      <div className={cn("grid gap-4 md:gap-6", className)} {...props}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="animate-pulse h-32"></Card>
          <Card className="animate-pulse h-32"></Card>
          <Card className="animate-pulse h-32"></Card>
        </div>
        <Card className="animate-pulse h-64"></Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4 md:gap-6", className)} {...props}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/30 p-4 md:p-6 rounded-xl border">
        <div>
          <h2 className="text-2xl font-bold">{employeeName}</h2>
          <p className="text-muted-foreground font-medium">Piecework Earnings Dashboard</p>
        </div>
        <Badge variant={employmentStatus === "active" ? "default" : "secondary"} className="uppercase tracking-wider">
          {employmentStatus.replace("_", " ")}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-950/40 dark:to-emerald-900/40 border-green-200 dark:border-green-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-green-800 dark:text-green-300 uppercase tracking-wider flex items-center justify-between">
              Accepted Work
              <CheckCircle2 className="w-4 h-4 opacity-70" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900 dark:text-green-100">
              {stats.acceptedPieces} <span className="text-lg font-medium opacity-70">pcs</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-amber-100 dark:from-orange-950/40 dark:to-amber-900/40 border-orange-200 dark:border-orange-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-orange-800 dark:text-orange-300 uppercase tracking-wider flex items-center justify-between">
              Pending QC
              <Clock className="w-4 h-4 opacity-70" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-900 dark:text-orange-100">
              {stats.pendingPieces} <span className="text-lg font-medium opacity-70">pcs</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-950/40 dark:to-indigo-900/40 border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wider flex items-center justify-between">
              Total Earned
              <Coins className="w-4 h-4 opacity-70" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">
              {stats.earnedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-lg font-medium opacity-70 ml-1">{stats.currency}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Adjustment History
          </CardTitle>
          <CardDescription>Recent bonuses, penalties, and corrections applied to your piecework.</CardDescription>
        </CardHeader>
        <CardContent>
          {adjustments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground border border-dashed rounded-lg">
              <AlertCircle className="w-8 h-8 opacity-20 mb-2" />
              <p>No adjustments found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {adjustments.map((adj) => (
                <div key={adj.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex flex-col">
                    <span className="font-semibold">{adj.reason}</span>
                    <span className="text-xs text-muted-foreground">{new Date(adj.date).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={cn(
                      "uppercase text-[10px]",
                      adj.type === "bonus" && "border-green-200 text-green-700 bg-green-50",
                      adj.type === "penalty" && "border-red-200 text-red-700 bg-red-50",
                      adj.type === "correction" && "border-blue-200 text-blue-700 bg-blue-50"
                    )}>
                      {adj.type}
                    </Badge>
                    <span className={cn(
                      "font-mono font-bold whitespace-nowrap min-w-[80px] text-right",
                      adj.amount > 0 ? "text-green-600" : adj.amount < 0 ? "text-red-600" : "text-muted-foreground"
                    )}>
                      {adj.amount > 0 ? "+" : ""}{adj.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {stats.currency}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
