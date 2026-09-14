import type { ManufacturingRepository } from "../domain/workflow/repository";
import {
  type DepartmentBoardQueryInput,
  departmentBoardQuerySchema,
} from "../domain/workflow/schemas";
import type { DepartmentBoardColumns, OperationBoardItem } from "../domain/workflow/types";
import { mapBoardRowToItem, mapFinishedOperationToItem } from "./board-mappers";

/**
 * Assembles the four-column department board. The open columns
 * (queue/working/delayed) come from a single `department_board` view
 * query, split client-side by `operation_status` since that's cheaper
 * than four separate filtered queries against the same small result set.
 * `finished` is a second, separate query (see
 * `ManufacturingRepository.getRecentlyFinished` for why).
 */
export async function getDepartmentBoard(
  repo: ManufacturingRepository,
  input: DepartmentBoardQueryInput
): Promise<DepartmentBoardColumns> {
  const { departmentId, finishedLimit } = departmentBoardQuerySchema.parse(input);

  const [openRows, finishedRows] = await Promise.all([
    repo.getDepartmentOpenBoardRows(departmentId),
    repo.getRecentlyFinished(departmentId, finishedLimit),
  ]);

  const queue: OperationBoardItem[] = [];
  const working: OperationBoardItem[] = [];
  const delayed: OperationBoardItem[] = [];

  for (const row of openRows) {
    const item = mapBoardRowToItem(row);
    if (row.operation_status === "queued" || row.operation_status === "rejected") {
      queue.push(item);
    } else if (row.operation_status === "in_progress" || row.operation_status === "paused") {
      working.push(item);
    } else if (row.operation_status === "delayed") {
      delayed.push(item);
    }
  }

  const finished = finishedRows.map(mapFinishedOperationToItem);

  const first = openRows[0];
  return {
    departmentId,
    departmentCode: first?.department_code ?? finished[0]?.departmentCode ?? "",
    departmentName: first?.department_name ?? finished[0]?.departmentName ?? "",
    queue,
    working,
    delayed,
    finished,
  };
}
