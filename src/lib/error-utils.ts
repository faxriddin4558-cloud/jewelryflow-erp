/**
 * Shared error parser utility for Supabase / PostgREST / JavaScript errors.
 * Ensures that plain error objects are never rendered as '[object Object]'.
 */
export function parseErrorMessage(err: unknown, fallback: string = "Amaliyotni bajarib bo'lmadi"): string {
  if (!err) return fallback;
  if (typeof err === "string") return err.trim() || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
    if (typeof o.details === "string" && o.details.trim()) return o.details.trim();
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (typeof o.hint === "string" && o.hint.trim()) return o.hint.trim();
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json;
    } catch {
      // fallback
    }
  }
  return String(err) || fallback;
}
