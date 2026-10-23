/**
 * Shared error parser utility for Supabase / PostgREST / JavaScript errors.
 * Ensures that plain error objects are never rendered as '[object Object]'.
 */
export function parseErrorMessage(err: unknown, fallback: string = "Amaliyotni bajarib bo'lmadi"): string {
  if (!err) return fallback;
  if (typeof err === "string") {
    const trimmed = err.trim();
    return trimmed && trimmed !== "[object Object]" ? trimmed : fallback;
  }
  if (err instanceof Error) {
    const msg = err.message?.trim();
    return msg && msg !== "[object Object]" ? msg : fallback;
  }
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim() && o.message.trim() !== "[object Object]") {
      return o.message.trim();
    }
    if (typeof o.error_description === "string" && o.error_description.trim()) {
      return o.error_description.trim();
    }
    if (typeof o.details === "string" && o.details.trim()) {
      return o.details.trim();
    }
    if (typeof o.error === "string" && o.error.trim()) {
      return o.error.trim();
    }
    if (typeof o.hint === "string" && o.hint.trim()) {
      return o.hint.trim();
    }
    if (typeof o.code === "string" && o.code.trim()) {
      return `Xatolik kodi: ${o.code.trim()}`;
    }
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json;
    } catch {
      // fallback
    }
  }
  const s = String(err);
  return s && s !== "[object Object]" ? s : fallback;
}
