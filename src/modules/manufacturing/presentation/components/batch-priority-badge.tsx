import { Badge } from "@/shared/ui/badge";
import type { BatchPriority } from "@/shared/types/database.types";

const PRIORITY_LABEL: Record<BatchPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const PRIORITY_VARIANT: Record<BatchPriority, "secondary" | "outline" | "progress" | "delayed"> = {
  low: "outline",
  normal: "secondary",
  high: "progress",
  urgent: "delayed",
};

export function BatchPriorityBadge({ priority }: { priority: BatchPriority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}
