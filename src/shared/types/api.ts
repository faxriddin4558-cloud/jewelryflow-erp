/**
 * Shared API response envelope. Every Route Handler / Server Action in
 * every module returns one of these two shapes so TanStack Query hooks
 * can be written generically against `ApiResult<T>` instead of each
 * module inventing its own success/error contract.
 */
export type ApiResult<T> = ApiSuccess<T> | ApiError;

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    /** Field-level validation issues, keyed by form field name. */
    fieldErrors?: Record<string, string[]>;
  };
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface SortParams<TColumn extends string = string> {
  column: TColumn;
  direction: "asc" | "desc";
}
