import * as React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface QueuedBatch {
  id: string;
  batchNumber: string;
  priority: "low" | "normal" | "high" | "urgent";
  queuedAt: string;
  modelName: string;
}

export interface StageQueueBoardProps {
  stageName: string;
  batches: QueuedBatch[];
  onSelectBatch?: (batchId: string) => void;
  className?: string;
}

export function StageQueueBoard({ stageName, batches, onSelectBatch, className }: StageQueueBoardProps) {
  return (
    <Card className={className}>
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-bold">{stageName} Queue</CardTitle>
          <Badge variant="secondary" className="text-sm">
            {batches.length} {batches.length === 1 ? "Batch" : "Batches"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {batches.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-muted-foreground">
            <p className="text-lg font-medium">No batches in queue</p>
            <p className="text-sm">New batches will appear here.</p>
          </div>
        ) : (
          <div className="divide-y">
            {batches.map((batch) => (
              <div
                key={batch.id}
                className={`flex items-center justify-between p-4 transition-colors hover:bg-muted/50 ${onSelectBatch ? "cursor-pointer" : ""}`}
                onClick={() => onSelectBatch?.(batch.id)}
                role={onSelectBatch ? "button" : undefined}
                tabIndex={onSelectBatch ? 0 : undefined}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-lg">{batch.batchNumber}</span>
                    {batch.priority === "urgent" && (
                      <Badge variant="destructive" className="uppercase text-[10px]">Urgent</Badge>
                    )}
                    {batch.priority === "high" && (
                      <Badge className="bg-amber-500 hover:bg-amber-600 uppercase text-[10px]">High</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{batch.modelName}</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>{formatDistanceToNow(new Date(batch.queuedAt))} ago</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
