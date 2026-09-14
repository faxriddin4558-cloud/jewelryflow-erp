import { Badge } from "@/shared/ui/badge";
import type { OperationStatus } from "@/shared/types/database.types";

const STATUS_LABEL: Record<OperationStatus, string> = {
  queued: "Queued",
  in_progress: "In Progress",
  paused: "Paused",
  completed: "Completed",
  delayed: "Delayed",
  skipped: "Skipped",
  rejected: "Rejected",
};

const STATUS_VARIANT: Record<OperationStatus, "queued" | "progress" | "hold" | "completed" | "delayed" | "cancelled"> = {
  queued: "queued",
  in_progress: "progress",
  paused: "hold",
  completed: "completed",
  delayed: "delayed",
  skipped: "cancelled",
  rejected: "delayed",
};

export function OperationStatusBadge({ status }: { status: OperationStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
