// Goldia Sales business date: the calendar date in Asia/Tashkent at the moment of the operation.
// Mirrors public._goldia_business_date() on the server (migration 073). Never use toISOString() (UTC) for a
// business date: between 00:00 and 05:00 Tashkent it is still the previous UTC day.
export const GOLDIA_TIME_ZONE = "Asia/Tashkent";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: GOLDIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD business date in Tashkent for `at` (default: now), optionally shifted by whole days. */
export function tashkentBusinessDate(at: Date | string | number = new Date(), offsetDays = 0): string {
  const base = at instanceof Date ? at.getTime() : new Date(at).getTime();
  const parts = formatter.formatToParts(new Date(base + offsetDays * 86_400_000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// PHASE F2: the opening T0 is typed as a Tashkent wall-clock time (datetime-local "YYYY-MM-DDTHH:MM"). Never let the
// browser's own time zone interpret it (new Date(value) would): Tashkent is UTC+05:00 all year (no daylight saving).
/** "2026-11-13T09:00" (Tashkent wall clock) -> "2026-11-13T09:00:00+05:00"; null when the value is not such a time. */
export function tashkentWallClockToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || "").trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** "13.11.2026 09:00" in Tashkent for any instant (independent of the browser's time zone). */
export function formatTashkent(at: Date | string | number): string {
  const d = at instanceof Date ? at : new Date(at);
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: GOLDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}.${g("month")}.${g("year")} ${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

/** Opening T0 rule: not in the future and not older than `maxAgeHours` (default 24). Returns an error text or null. */
export function openingT0Problem(iso: string | null, now: Date = new Date(), maxAgeHours = 24): string | null {
  if (!iso) return "T0 sana va vaqtini to'liq kiriting (Toshkent vaqti)";
  const t = new Date(iso).getTime();
  if (t > now.getTime() + 60_000) return "T0 kelajakda bo'lishi mumkin emas";
  if (t < now.getTime() - maxAgeHours * 3_600_000) return `T0 ${maxAgeHours} soatdan eski bo'lishi mumkin emas`;
  return null;
}
