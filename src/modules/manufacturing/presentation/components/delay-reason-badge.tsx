import { Badge } from "@/shared/ui/badge";
import type { DelayReasonCategory } from "@/shared/types/database.types";

const DELAY_REASON_LABEL: Record<DelayReasonCategory, string> = {
  machine_breakdown: "Machine Breakdown",
  material_shortage: "Material Shortage",
  employee_unavailable: "Employee Unavailable",
  power_outage: "Power Outage",
  quality_rework: "Quality Rework",
  design_change: "Design Change",
  other: "Other",
};

export function DelayReasonBadge({
  category,
  minutes,
}: {
  category: DelayReasonCategory;
  minutes?: number | null;
}) {
  return (
    <Badge variant="delayed">
      {DELAY_REASON_LABEL[category]}
      {typeof minutes === "number" && minutes > 0 ? ` · ${minutes}m` : ""}
    </Badge>
  );
}
