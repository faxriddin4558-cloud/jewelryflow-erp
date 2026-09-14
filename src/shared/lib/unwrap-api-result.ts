import type { ApiResult } from "@/shared/types/api";

/**
 * TanStack Query expects a query/mutation function to either resolve with
 * data or throw. Every Server Action in this app returns `ApiResult<T>`
 * instead of throwing, so hooks funnel the result through this to get
 * normal `isError`/`error` behavior without each hook re-implementing the
 * unwrap.
 */
export function unwrapApiResult<T>(result: ApiResult<T>): T {
  if (!result.success) {
    throw new ApiResultError(result.error.message, result.error.code, result.error.fieldErrors);
  }
  return result.data;
}

export class ApiResultError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fieldErrors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiResultError";
  }
}
