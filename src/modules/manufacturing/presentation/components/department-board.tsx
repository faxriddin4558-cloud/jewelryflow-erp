"use client";

import { Skeleton } from "@/shared/ui/skeleton";
import { useDepartmentBoard } from "../hooks/use-department-board";
import { OperationCard } from "./operation-card";
import type { OperationBoardItem } from "../../domain/workflow/types";

interface ColumnProps {
  title: string;
  count: number;
  items: OperationBoardItem[];
  emptyLabel: string;
  accentClassName: string;
}

function BoardColumn({ title, count, items, emptyLabel, accentClassName }: ColumnProps) {
  return (
    <div className="flex min-w-[280px] flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className={`text-sm font-semibold ${accentClassName}`}>{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          items.map((item) => <OperationCard key={item.operationId} item={item} />)
        )}
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto">
      {Array.from({ length: 4 }).map((_, columnIndex) => (
        <div key={columnIndex} className="flex min-w-[280px] flex-1 flex-col gap-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * The core Manufacturing Workflow Engine UI: a live, polled four-column
 * board for one department. `departmentId` is resolved server-side from
 * the route's stable `code` (see `department-workflow-page.tsx`) so this
 * component only ever deals in UUIDs.
 */
export function DepartmentBoard({ departmentId }: { departmentId: string }) {
  const { data, isLoading, isError, error } = useDepartmentBoard(departmentId);

  if (isLoading) {
    return <BoardSkeleton />;
  }

  if (isError) {
    return (
      <p className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load the board: {error instanceof Error ? error.message : "Unknown error."}
      </p>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      <BoardColumn
        title="Queue"
        count={data.queue.length}
        items={data.queue}
        emptyLabel="No batches waiting."
        accentClassName="text-[hsl(var(--status-queued))]"
      />
      <BoardColumn
        title="Working"
        count={data.working.length}
        items={data.working}
        emptyLabel="Nothing currently in progress."
        accentClassName="text-[hsl(var(--status-progress))]"
      />
      <BoardColumn
        title="Delayed"
        count={data.delayed.length}
        items={data.delayed}
        emptyLabel="No delays reported."
        accentClassName="text-[hsl(var(--status-delayed))]"
      />
      <BoardColumn
        title="Finished"
        count={data.finished.length}
        items={data.finished}
        emptyLabel="Nothing finished yet."
        accentClassName="text-[hsl(var(--status-completed))]"
      />
    </div>
  );
}
