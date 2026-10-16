import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import type { BatchStatus, BatchPriority } from "@/shared/types/database.types";
import { ManufacturingStatusBadge } from "./ManufacturingStatusBadge";
import { Layers, Clock } from "lucide-react";

export interface BatchProgressCardProps extends React.HTMLAttributes<HTMLDivElement> {
  batchNumber?: string;
  status?: BatchStatus;
  priority?: BatchPriority;
  currentStage?: string;
  department?: string;
  dueDate?: string | null;
  isLoading?: boolean;
}

const PRIORITY_COLORS: Record<BatchPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  urgent: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export function BatchProgressCard({
  batchNumber,
  status,
  priority,
  currentStage,
  department,
  dueDate,
  isLoading,
  className,
  ...props
}: BatchProgressCardProps) {
  if (isLoading) {
    return (
      <Card className={cn("animate-pulse", className)} {...props}>
        <CardHeader className="md:p-5 p-4 flex flex-row items-center gap-4">
          <div className="w-12 h-12 bg-muted rounded-full"></div>
          <div className="space-y-2 flex-1">
            <div className="h-4 bg-muted rounded w-1/3"></div>
            <div className="h-3 bg-muted rounded w-1/4"></div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  if (!batchNumber) {
    return (
      <Card className={cn("flex items-center justify-center min-h-[120px] text-muted-foreground", className)} {...props}>
        <div className="text-center space-y-2 flex flex-col items-center">
          <Layers className="h-8 w-8 opacity-20" />
          <p className="text-sm font-medium">No Batch Selected</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("overflow-hidden md:rounded-xl touch-manipulation", className)} {...props}>
      <CardHeader className="md:p-5 p-4 bg-muted/30 pb-4 border-b">
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <span className="font-mono">{batchNumber}</span>
              {priority && priority !== "normal" && (
                <Badge className={cn("text-xs uppercase tracking-wider font-semibold", PRIORITY_COLORS[priority])}>
                  {priority}
                </Badge>
              )}
            </CardTitle>
            {department && (
              <CardDescription className="text-sm md:text-base font-medium flex items-center gap-1.5">
                {department}
              </CardDescription>
            )}
          </div>
          {status && <ManufacturingStatusBadge type="batch" status={status} />}
        </div>
      </CardHeader>
      <CardContent className="md:p-5 p-4 flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Current Stage</span>
          <span className="text-base md:text-lg font-medium">{currentStage || "Unassigned"}</span>
        </div>

        {dueDate && (
          <div className="flex items-center gap-2 text-sm md:text-base bg-muted/50 px-3 py-2 rounded-md">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">Due: {new Date(dueDate).toLocaleDateString()}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
