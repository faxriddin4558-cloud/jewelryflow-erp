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
