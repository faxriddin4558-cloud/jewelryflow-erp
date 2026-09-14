import { notFound } from "next/navigation";
import { getManufacturingRepository } from "../infrastructure/departments/factory";
import { getDepartmentByCode } from "../application";
import { DepartmentCodeNotFoundError, isWorkflowError } from "../domain/workflow/workflow-errors";
import { DepartmentBoard } from "./components/department-board";
import type { DepartmentRouteSlug } from "./config/departments.config";
import { getDepartmentRouteConfig } from "./config/departments.config";

/**
 * Shared page body for every `(dashboard)/manufacturing/<slug>/page.tsx`
 * route. Resolves the department's UUID server-side (once, per request)
 * from its stable `code`, then hands off to the client-side
 * `DepartmentBoard`, which owns the live polling from there.
 *
 * Calling `getDepartmentByCode` directly (not through a `"use server"`
 * Server Action) is deliberate: this runs inside a Server Component
 * during the initial render, not in response to a client-triggered
 * mutation, so there's no boundary to cross — the Server Action layer in
 * `presentation/actions/` exists for the client hooks, not for RSCs.
 */
export async function DepartmentWorkflowPage({ slug }: { slug: DepartmentRouteSlug }) {
  const { code, title } = getDepartmentRouteConfig(slug);

  const repo = await getManufacturingRepository();

  let departmentId: string;
  try {
    const department = await getDepartmentByCode(repo, { code });
    departmentId = department.id;
  } catch (error) {
    if (isWorkflowError(error) && error instanceof DepartmentCodeNotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          Queue, Working, Delayed, and Finished operations for this department.
        </p>
      </div>
      <DepartmentBoard departmentId={departmentId} />
    </div>
  );
}
