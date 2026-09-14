import type { ManufacturingRepository } from "../domain/workflow/repository";
import type { DepartmentRef } from "../domain/workflow/repository";
import {
  type DepartmentByCodeQueryInput,
  departmentByCodeQuerySchema,
} from "../domain/workflow/schemas";
import { DepartmentCodeNotFoundError } from "../domain/workflow/workflow-errors";

/**
 * Resolves a department's stable `code` (the constant every manufacturing
 * route is keyed by — see `presentation/config/departments.config.ts`) to
 * its `{ id, code, name }`. Pages call this once, server-side, before
 * rendering the client board so the board hook always receives a real
 * UUID rather than re-resolving the code on every poll.
 */
export async function getDepartmentByCode(
  repo: ManufacturingRepository,
  input: DepartmentByCodeQueryInput
): Promise<DepartmentRef> {
  const { code } = departmentByCodeQuerySchema.parse(input);

  const department = await repo.findDepartmentByCode(code);
  if (!department) {
    throw new DepartmentCodeNotFoundError(code);
  }

  return department;
}

