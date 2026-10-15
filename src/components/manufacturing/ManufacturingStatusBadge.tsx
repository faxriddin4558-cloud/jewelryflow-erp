import * as React from "react";
import { Badge, type BadgeProps } from "@/shared/ui/badge";

export type BatchStatus = "pending" | "queued" | "in_progress" | "delayed" | "on_hold" | "completed" | "cancelled";
export type OperationStatus = "queued" | "in_progress" | "paused" | "completed" | "delayed" | "skipped" | "rejected";

export type ManufacturingStatusBadgeProps = Omit<BadgeProps, "variant"> & {
  status: BatchStatus | OperationStatus;
};

export function ManufacturingStatusBadge({ status, className, ...props }: ManufacturingStatusBadgeProps) {
  let variant: BadgeProps["variant"] = "default";
  let label = status as string;

  switch (status) {
    case "pending":
      variant = "pending";
      label = "Pending";
      break;
    case "queued":
      variant = "queued";
      label = "Queued";
      break;
    case "in_progress":
      variant = "progress";
      label = "In Progress";
      break;
    case "delayed":
      variant = "delayed";
      label = "Delayed";
      break;
    case "on_hold":
      variant = "hold";
      label = "On Hold";
      break;
    case "paused":
      variant = "hold";
      label = "Paused";
      break;
    case "completed":
      variant = "completed";
      label = "Completed";
      break;
    case "cancelled":
      variant = "cancelled";
      label = "Cancelled";
      break;
    case "skipped":
      variant = "outline";
      label = "Skipped";
      break;
    case "rejected":
      variant = "destructive";
      label = "Rejected";
      break;
    default:
      variant = "default";
      break;
  }

  return (
    <Badge variant={variant} className={className} {...props}>
      {label}
    </Badge>
  );
}
