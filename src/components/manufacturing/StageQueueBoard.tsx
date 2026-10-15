import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/shared/ui/card";
import { ManufacturingStatusBadge } from "./ManufacturingStatusBadge";
import type { BatchPriority, OperationStatus } from "@/shared/types/database.types";

export interface QueueItem {
  id: string;
  batchNumber: string;
  priority: BatchPriority;
  status: OperationStatus;
  assignedTo?: string;
  queuedAt?: string;
}

export interface StageQueueBoardProps extends React.HTMLAttributes<HTMLDivElement> {
  stageName: string;
  machineOccupied?: boolean;
  activeItem?: QueueItem;
  queueItems: QueueItem[];
  isLoading?: boolean;
}

export function StageQueueBoard({
  stageName,
  machineOccupied,
  activeItem,
  queueItems,
  isLoading,
  className,
  ...props
}: StageQueueBoardProps) {
  if (isLoading) {
    return (
      <Card className={cn("animate-pulse min-h-[300px]", className)} {...props}>
        <CardHeader className="bg-muted pb-4 border-b">
          <div className="h-6 w-1/3 bg-muted-foreground/20 rounded"></div>
        </CardHeader>
        <CardContent className="p-4 space-y-4 mt-4">
          <div className="h-20 bg-muted rounded-xl"></div>
          <div className="h-16 bg-muted/50 rounded-xl"></div>
          <div className="h-16 bg-muted/50 rounded-xl"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("flex flex-col h-full md:rounded-xl overflow-hidden", className)} {...props}>
      <CardHeader className={cn("md:p-5 p-4 border-b", machineOccupied ? "bg-primary/10" : "bg-muted/30")}>
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg md:text-xl font-bold flex items-center gap-2">
            {stageName}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded-full", machineOccupied ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
              {machineOccupied ? "Occupied" : "Available"}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-3 md:p-5 flex flex-col gap-4 bg-muted/10 overflow-y-auto">
        <div className="flex flex-col gap-2">
          <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">On Machine</h4>
          {activeItem ? (
            <div className="bg-background border shadow-sm rounded-lg p-3 md:p-4 flex flex-col gap-3 relative overflow-hidden ring-1 ring-primary">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-mono font-bold text-lg">{activeItem.batchNumber}</span>
                  {activeItem.assignedTo && <p className="text-sm text-muted-foreground mt-1">Operator: {activeItem.assignedTo}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                   <ManufacturingStatusBadge type="operation" status={activeItem.status} />
                   {activeItem.priority !== "normal" && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 uppercase">{activeItem.priority}</span>
                   )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-background/50 border border-dashed rounded-lg p-6 flex items-center justify-center text-muted-foreground">
              <p className="text-sm font-medium">Machine is idle</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 mt-2">
          <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Up Next ({queueItems.length})</h4>
          {queueItems.length === 0 ? (
            <div className="bg-background/50 border rounded-lg p-4 text-center text-muted-foreground text-sm">
              No batches in queue
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {queueItems.map((item) => (
                <div key={item.id} className="bg-background border rounded-lg p-3 flex justify-between items-center opacity-80 hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold">{item.batchNumber}</span>
                    {item.priority !== "normal" && (
                       <div className="w-2 h-2 rounded-full bg-orange-500" title={`Priority: ${item.priority}`}></div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {item.queuedAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.queuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <ManufacturingStatusBadge type="operation" status={item.status} className="scale-90 origin-right" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
