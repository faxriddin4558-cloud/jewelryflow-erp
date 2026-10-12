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

  let empRow: Record<string, unknown> | null = null;
  const { data: byUserIdRows, error: byUserIdErr } = await supabase
    .from("employees")
    .select("*")
    .eq("user_id", user.id)
    .limit(1);

  if (!byUserIdErr && byUserIdRows && byUserIdRows[0]) {
    empRow = byUserIdRows[0] as Record<string, unknown>;
  } else {
    const { data: byIdRows, error: byIdErr } = await supabase
      .from("employees")
      .select("*")
      .eq("id", user.id)
      .limit(1);
    if (!byIdErr && byIdRows && byIdRows[0]) {
      empRow = byIdRows[0] as Record<string, unknown>;
    }
  }

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
      empRow.role &&
        !["department_operator", "zargar", "operator", ""].includes(
          String(empRow.role).trim().toLowerCase()
        )
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

  return empRow && empRow.id != null ? String(empRow.id) : user.id;
}
