/**
 * Maps each `(dashboard)/manufacturing/<slug>` route folder to the stable
 * `departments.code` it displays (see `supabase/seed/01_departments_and_workflow.sql`).
 *
 * Only the 15 department routes that already exist as folders under
 * `src/app/(dashboard)/manufacturing/` are listed here. Two seeded
 * departments — WAX and CLEANING — don't yet have a route folder (the
 * pipeline visits CLEANING three times between other stages but it has
 * no dedicated board page in this cut). Adding either later is a
 * one-line addition here plus a new route folder; the engine underneath
 * (`getDepartmentByCode` + `DepartmentBoard`) already supports any
 * department code with zero further changes.
 */
export const DEPARTMENT_ROUTE_CONFIG = {
  "wax-assembly": { code: "WAX_ASM", title: "Wax Assembly" },
  investment: { code: "INVESTMENT", title: "Investment" },
  "burnout-furnace": { code: "BURNOUT", title: "Burnout Furnace" },
  casting: { code: "CASTING", title: "Casting" },
  tumbling: { code: "TUMBLING", title: "Tumbling" },
  straightening: { code: "STRAIGHTEN", title: "Straightening" },
  sanding: { code: "SANDING", title: "Sanding" },
  pumice: { code: "PUMICE", title: "Pumice Machine" },
  "pre-polish": { code: "PRE_POLISH", title: "Pre-Polish Machine" },
  zircon: { code: "ZIRCON", title: "Zircon Machine" },
  "final-polish": { code: "FINAL_POLISH", title: "Final Polish" },
  "laser-decoration": { code: "LASER", title: "Laser Decoration" },
  "quick-polish": { code: "QUICK_POLISH", title: "Quick Polish" },
  washing: { code: "WASHING", title: "Washing" },
  packaging: { code: "PACKAGING", title: "Packaging" },
} as const satisfies Record<string, { code: string; title: string }>;

export type DepartmentRouteSlug = keyof typeof DEPARTMENT_ROUTE_CONFIG;

export function getDepartmentRouteConfig(slug: DepartmentRouteSlug) {
  return DEPARTMENT_ROUTE_CONFIG[slug];
}
