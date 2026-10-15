import * as React from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { ManufacturingStatusBadge, type BatchStatus } from "./ManufacturingStatusBadge";
import { Clock, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface BatchProgressInfo {
  batchNumber: string;
  modelName: string;
  status: BatchStatus;
  currentStageName: string;
  assignedEmployeeName: string | null;
  startedAt: string | null;
}

export interface BatchProgressCardProps {
  batch?: BatchProgressInfo;
  isLoading?: boolean;
  error?: string;
  className?: string;
}

export function BatchProgressCard({ batch, isLoading, error, className }: BatchProgressCardProps) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
        <CardFooter>
          <Skeleton className="h-8 w-24" />
        </CardFooter>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="flex h-32 items-center justify-center text-destructive">
          <p>Error loading batch details: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!batch) {
    return (
      <Card className={className}>
        <CardContent className="flex h-32 items-center justify-center text-muted-foreground">
          <p>No batch data available.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-lg font-bold">{batch.batchNumber}</CardTitle>
          <p className="text-sm text-muted-foreground">{batch.modelName}</p>
        </div>
        <ManufacturingStatusBadge status={batch.status} />
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Stage</p>
            <p className="text-sm font-semibold">{batch.currentStageName}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assigned To</p>
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>{batch.assignedEmployeeName || "Unassigned"}</span>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="bg-muted/50 border-t py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>
            {batch.startedAt
              ? `Started ${formatDistanceToNow(new Date(batch.startedAt))} ago`
              : "Not started yet"}
          </span>
        </div>
      </CardFooter>
    </Card>
  );
}
