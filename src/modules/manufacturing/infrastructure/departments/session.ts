import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UnauthorizedWorkflowActionError } from "../../domain/workflow/workflow-errors";

const WRITE_AUTHORIZED_WORKFLOW_ROLES = new Set([
  "admin",
  "director",
  "owner",
  "production_manager",
  "production manager",
  "manager",
  "department_head",
  "supervisor",
  "master",
  "department_operator",
  "quality_inspector",
  "quality_control",
  "worker",
]);

/**
 * Resolves the authenticated employee session on the server and enforces
 * server-side role & employment_status checks before executing workflow mutations
 * (defense-in-depth alongside PostgreSQL RLS in migrations 014 and 017).
 */
export async function requireCurrentEmployeeId(options?: {
  requireWritePermission?: boolean;
}): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new UnauthorizedWorkflowActionError("You must be signed in to perform this action.");
  }

  const { data: empRows } = await supabase
    .from("employees")
    .select("*")
    .or(`id.eq.${user.id},user_id.eq.${user.id}`)
    .limit(1);

  const empRow = (empRows && empRows[0] ? (empRows[0] as Record<string, unknown>) : null);

  const requireWrite = options?.requireWritePermission ?? true;
  if (requireWrite) {
    if (!empRow) {
      throw new UnauthorizedWorkflowActionError(
        "No active employee profile found for the signed-in user."
      );
    }

    const isActive = empRow.is_active !== false;
    const status = String(empRow.status ?? empRow.employment_status ?? "active").toLowerCase();
    if (!isActive || (status !== "active" && status !== "faol")) {
      throw new UnauthorizedWorkflowActionError(
        "Your employee account is not active for manufacturing operations."
      );
    }

    const rawRole = String(
      empRow.role && String(empRow.role) !== "department_operator"
        ? empRow.role
        : empRow.role_type || empRow.position || empRow.role || "viewer"
    )
      .trim()
      .toLowerCase();

    if (!WRITE_AUTHORIZED_WORKFLOW_ROLES.has(rawRole)) {
      throw new UnauthorizedWorkflowActionError(
        `Role "${rawRole}" is not authorized to mutate manufacturing operations.`
      );
    }
  }

  return empRow && typeof empRow.id === "string" ? empRow.id : user.id;
}
