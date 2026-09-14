import { ZodError } from "zod";
import type { ApiError, ApiErrorCode, ApiResult } from "@/shared/types/api";
import { isWorkflowError } from "../domain/workflow/workflow-errors";

const WORKFLOW_ERROR_HTTP_CODE: Record<string, ApiErrorCode> = {
  INVALID_OPERATION_TRANSITION: "CONFLICT",
  OPERATION_NOT_FOUND: "NOT_FOUND",
  BATCH_NOT_FOUND: "NOT_FOUND",
  BATCH_ALREADY_ACTIVE: "CONFLICT",
  MISSING_DELAY_REASON: "VALIDATION_ERROR",
  NEXT_STAGE_NOT_CONFIGURED: "INTERNAL_ERROR",
  REWORK_TARGET_STAGE_NOT_FOUND: "NOT_FOUND",
  DEPARTMENT_NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED_WORKFLOW_ACTION: "FORBIDDEN",
};

/**
 * Every Server Action in `presentation/actions/` wraps its use-case call
 * in a try/catch that funnels into this function, so the client always
 * receives a well-typed `ApiResult<T>` — never a thrown exception across
 * the Server Action boundary.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_root";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "One or more fields are invalid.",
        fieldErrors,
      },
    };
  }

  if (isWorkflowError(error)) {
    return {
      success: false,
      error: {
        code: WORKFLOW_ERROR_HTTP_CODE[error.code] ?? "INTERNAL_ERROR",
        message: error.message,
      },
    };
  }

  return {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred. Please try again.",
    },
  };
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    return toApiError(error);
  }
}
