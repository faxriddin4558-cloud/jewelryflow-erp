"use client";

import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import type { OperationBoardItem } from "../../domain/workflow/types";
import { OperationStatusBadge } from "./operation-status-badge";
import { BatchPriorityBadge } from "./batch-priority-badge";
import { DelayReasonBadge } from "./delay-reason-badge";
import { CompleteOperationDialog } from "./complete-operation-dialog";
import { FlagDelayDialog } from "./flag-delay-dialog";
import { RejectReworkDialog } from "./reject-rework-dialog";
import {
  usePauseOperation,
  useResumeOperation,
  useStartOperation,
} from "../hooks/use-operation-mutations";

function formatWaiting(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function OperationCard({ item }: { item: OperationBoardItem }) {
  const startOperation = useStartOperation();
  const pauseOperation = usePauseOperation();
  const resumeOperation = useResumeOperation();

  const isBusy = startOperation.isPending || pauseOperation.isPending || resumeOperation.isPending;

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-semibold">{item.batchNumber}</span>
          <BatchPriorityBadge priority={item.batchPriority} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{item.stageName}</span>
          <OperationStatusBadge status={item.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {item.assignedEmployeeName && <span>👤 {item.assignedEmployeeName}</span>}
          <span>⏱ waiting {formatWaiting(item.queuedAt)}</span>
          {item.delayReasonCategory && (
            <DelayReasonBadge category={item.delayReasonCategory} minutes={item.delayedMinutes} />
          )}
        </div>

        {(item.status === "queued" || item.status === "delayed") && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => startOperation.mutate({ operationId: item.operationId })}
            >
              Start
            </Button>
            <FlagDelayDialog
              operationId={item.operationId}
              trigger={
                <Button size="sm" variant="outline">
                  Flag Delay
                </Button>
              }
            />
          </div>
        )}

        {item.status === "paused" && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => resumeOperation.mutate({ operationId: item.operationId })}
            >
              Resume
            </Button>
            <FlagDelayDialog
              operationId={item.operationId}
              trigger={
                <Button size="sm" variant="outline">
                  Flag Delay
                </Button>
              }
            />
          </div>
        )}

        {item.status === "in_progress" && (
          <div className="flex flex-wrap gap-2">
            <CompleteOperationDialog
              operationId={item.operationId}
              stageName={item.stageName}
              trigger={<Button size="sm">Complete</Button>}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => pauseOperation.mutate({ operationId: item.operationId })}
            >
              Pause
            </Button>
            <FlagDelayDialog
              operationId={item.operationId}
              trigger={
                <Button size="sm" variant="outline">
                  Flag Delay
                </Button>
              }
            />
            <RejectReworkDialog
              operationId={item.operationId}
              stageName={item.stageName}
              trigger={
                <Button size="sm" variant="destructive">
                  Reject
                </Button>
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
