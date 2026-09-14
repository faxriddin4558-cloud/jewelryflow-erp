import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UnauthorizedWorkflowActionError } from "../../domain/workflow/workflow-errors";

/**
 * `employees.id` is defined to equal `auth.users.id` (see the comment on
 * `employees.Insert.id` in `database.types.ts`), so resolving "who is
 * making this request" is just reading the authenticated user's id — RLS
 * (migration 014) then does the actual authorization on every query using
 * `current_employee_role()`. This helper exists so Server Actions never
 * inline `supabase.auth.getUser()` themselves and forget the null check.
 */
export async function requireCurrentEmployeeId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new UnauthorizedWorkflowActionError("You must be signed in to perform this action.");
  }

  return user.id;
}
