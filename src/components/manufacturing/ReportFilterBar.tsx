import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Filter, Download, Printer } from "lucide-react";

export interface ReportFilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  onFilterClick?: () => void;
  onExportClick?: () => void;
  onPrintClick?: () => void;
  activeFilterCount?: number;
}

export function ReportFilterBar({
  onFilterClick,
  onExportClick,
  onPrintClick,
  activeFilterCount = 0,
  className,
  children,
  ...props
}: ReportFilterBarProps) {
  return (
    <div className={cn("flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 bg-muted/20 border rounded-lg", className)} {...props}>
      <div className="flex-1 w-full flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onFilterClick} className="gap-2 shrink-0">
          <Filter className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
        {children && <div className="flex-1 flex gap-2 overflow-x-auto pb-1 md:pb-0">{children}</div>}
      </div>

      <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
        {onExportClick && (
          <Button variant="outline" size="sm" onClick={onExportClick} className="gap-2">
            <Download className="w-4 h-4" />
            <span className="hidden md:inline">Export CSV</span>
          </Button>
        )}
        {onPrintClick && (
          <Button variant="outline" size="sm" onClick={onPrintClick} className="gap-2">
            <Printer className="w-4 h-4" />
            <span className="hidden md:inline">Print Summary</span>
          </Button>
        )}
      </div>
    </div>
  );
}
