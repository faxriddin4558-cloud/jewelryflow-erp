import * as React from "react";
import { Badge } from "@/shared/ui/badge";
import type { BatchStatus, OperationStatus } from "@/shared/types/database.types";

export interface ManufacturingStatusBadgeProps {
  type: "batch" | "operation";
  status: BatchStatus | OperationStatus;
  className?: string;
}

const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  pending: "Pending",
  queued: "Queued",
  in_progress: "In Progress",
  delayed: "Delayed",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

const BATCH_STATUS_VARIANT: Record<BatchStatus, "pending" | "queued" | "progress" | "delayed" | "hold" | "completed" | "cancelled"> = {
  pending: "pending",
  queued: "queued",
  in_progress: "progress",
  delayed: "delayed",
  on_hold: "hold",
  completed: "completed",
  cancelled: "cancelled",
};

const OPERATION_STATUS_LABEL: Record<OperationStatus, string> = {
  queued: "Queued",
  in_progress: "In Progress",
  paused: "Paused",
  completed: "Completed",
  delayed: "Delayed",
  skipped: "Skipped",
  rejected: "Rejected",
};

const OPERATION_STATUS_VARIANT: Record<OperationStatus, "queued" | "progress" | "hold" | "completed" | "delayed" | "cancelled"> = {
  queued: "queued",
  in_progress: "progress",
  paused: "hold",
  completed: "completed",
  delayed: "delayed",
  skipped: "cancelled",
  rejected: "delayed", // Map rejected to delayed/red visually
};

export function ManufacturingStatusBadge({ type, status, className }: ManufacturingStatusBadgeProps) {
  let label = "";
  let variant: "pending" | "queued" | "progress" | "delayed" | "hold" | "completed" | "cancelled" | "default" = "default";

  if (type === "batch") {
    label = BATCH_STATUS_LABEL[status as BatchStatus] || status;
    variant = BATCH_STATUS_VARIANT[status as BatchStatus] || "default";
  } else {
    label = OPERATION_STATUS_LABEL[status as OperationStatus] || status;
    variant = OPERATION_STATUS_VARIANT[status as OperationStatus] || "default";
  }

  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
