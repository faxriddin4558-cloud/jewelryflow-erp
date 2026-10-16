import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Card } from "@/shared/ui/card";

export interface ColumnDef<T> {
  header: string;
  accessorKey: keyof T | string;
  cell?: (item: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}

export interface ReportDataTableProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
}

export function ReportDataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading,
  emptyMessage = "No data available.",
  className,
  ...props
}: ReportDataTableProps<T>) {

  if (isLoading) {
    return (
      <Card className={cn("w-full overflow-hidden", className)} {...props}>
        <div className="w-full h-12 border-b bg-muted/30 animate-pulse"></div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="w-full h-14 border-b animate-pulse bg-muted/10"></div>
        ))}
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className={cn("w-full p-8 flex items-center justify-center text-muted-foreground border-dashed", className)} {...props}>
        {emptyMessage}
      </Card>
    );
  }

  return (
    <Card className={cn("w-full overflow-hidden", className)} {...props}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b">
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className={cn(
                    "px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs",
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((row) => (
              <tr key={keyExtractor(row)} className="hover:bg-muted/10 transition-colors">
                {columns.map((col, idx) => (
                  <td
                    key={idx}
                    className={cn(
                      "px-4 py-3 whitespace-nowrap",
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                      col.className
                    )}
                  >
                    {col.cell ? col.cell(row) : ((row as unknown) as Record<string, React.ReactNode>)[col.accessorKey as string]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
