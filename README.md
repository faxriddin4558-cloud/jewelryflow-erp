# JewelryFlow ERP

Enterprise manufacturing ERP for jewelry factories. This commit contains the
**foundation only**: project scaffolding, database schema, folder
architecture, type definitions, and Supabase configuration — no feature
logic yet, per the current build phase.

## Stack

Next.js 15 (App Router) · React 18 · TypeScript (strict) · Tailwind CSS ·
shadcn/ui · Supabase (Postgres + Auth + Storage) · TanStack Query · Zod ·
React Hook Form

## Architecture

**Clean architecture, feature-modular.** Every business capability lives
under `src/modules/<feature>` with four layers:

```
src/modules/<feature>/
├── domain/           # entities, value objects, Zod schemas — no I/O, no framework code
├── application/      # use-cases / services that orchestrate domain + infrastructure
├── infrastructure/   # Supabase queries, repositories — the only layer allowed to import supabase-js
└── presentation/
    ├── components/   # feature-specific React components
    └── hooks/        # TanStack Query hooks wrapping application use-cases
```

Dependency direction is strictly inward: `presentation → application →
domain`, with `infrastructure` implementing interfaces defined in `domain`.
Nothing in `domain/` imports React, Next.js, or Supabase.

`src/modules/manufacturing` is the one module spanning many physical
departments (Casting, Investment, Burnout, Finishing, Laser, Polishing,
etc). Per **composition over duplication**, department-specific screens are
thin configuration layered on one shared workflow/queue engine
(`domain/workflow`, `infrastructure/departments`) rather than N copy-pasted
department modules.

`src/shared/` holds cross-module code with no feature ownership:

```
src/shared/
├── ui/           # shadcn/ui primitives (generated here via components.json)
├── lib/          # cn(), validation/enums.ts (Zod mirrors of Postgres enums), etc.
├── hooks/        # generic hooks (useDebounce, useMediaQuery, ...)
├── types/        # database.types.ts, domain.ts, api.ts
└── config/       # app-wide constants
```

`src/lib/supabase/` holds the three Supabase client constructors
(`client.ts` browser, `server.ts` server + service-role, `middleware.ts`
session refresh) — infrastructure that every module's `infrastructure/`
layer depends on, but that isn't itself feature-owned.

`src/app/` is exclusively Next.js App Router routing: route groups
`(auth)` and `(dashboard)`, each `page.tsx` thin and delegating into the
matching `src/modules/*/presentation` components. No business logic will
ever live in `src/app`.

## Database

All schema changes are migrations under `supabase/migrations/`, applied in
order:

| # | File | Purpose |
|---|------|---------|
| 001 | `extensions_and_enums.sql` | Postgres extensions + every enum type (roles, statuses, delay reasons, gold purity, etc.) |
| 002 | `departments_and_workflow_stages.sql` | Physical departments + the ordered, editable 20-stage pipeline |
| 003 | `employees.sql` | Staff profiles, 1:1 with `auth.users`, auto-provisioned on sign-up |
| 004 | `customers.sql` | Customers |
| 005 | `jewelry_models.sql` | Reusable model/design templates + reference images |
| 006 | `orders.sql` | Orders + order line items |
| 007 | `batches.sql` | Batches, batch↔model mapping, batch photos, status history (with auto-logging trigger) |
| 008 | `batch_operations.sql` | **Core tracking table**: one row per (batch, stage, attempt) — started/finished/employee/department/duration/delay, with triggers syncing `batches.current_stage_id` and auto-completing batches |
| 009 | `inventory.sql` | Non-gold materials + immutable transaction ledger with balance-maintaining trigger |
| 010 | `gold_tracking.sql` | Gold lots + immutable transaction ledger (issue/return/melt-loss/scrap) + `batch_gold_summary` view |
| 011 | `quality_control.sql` | QC checklists + inspections, auto-flags batch `on_hold` on failure |
| 012 | `audit_log.sql` | Generic before/after JSON audit trail on sensitive tables |
| 013 | `views.sql` | `department_board`, `factory_dashboard_summary`, `stage_duration_stats` — the read-models the UI queries directly |
| 014 | `rls_policies.sql` | Row Level Security: role-based read/write policies for every table |

Seed data (`supabase/seed/01_departments_and_workflow.sql`) loads the fixed
17 departments and 20 workflow stages exactly as specified (Wax → Wax
Assembly → Investment → Burnout Furnace → Casting → Tumbling →
Straightening → Sanding → Pumice → Cleaning → Pre-Polish → Cleaning →
Zircon → Cleaning → Final Polish → Laser Decoration → Quick Polish →
Washing → Packaging → Completed). This is reference/config data, not
business logic — sequence and stages can be edited later via Settings
without a schema change.

### Key design decisions

- **`workflow_stages` is data, not an enum.** The factory's routing changes
  over time; reordering or inserting a stage must never require a code
  deploy or migration touching application code.
- **`batch_operations` is the single source of truth** for "what happened,
  when, by whom, in which department, for how long, and why it was
  delayed" — every requirement in the spec's "Every operation stores..."
  section maps directly to a column, with `duration_seconds` as a
  `generated always as` column so it can never drift from
  `started_at`/`finished_at`.
- **Ledgers are immutable.** `inventory_transactions`, `gold_transactions`,
  and `qc_inspections` are insert-only; running balances
  (`quantity_on_hand`, `remaining_weight_grams`) are maintained by
  triggers, never written directly by the application — this is what makes
  gold weight reconciliation auditable.
- **RLS is role-based**, keyed off `employees.role`, with department
  operators scoped to their own `primary_department_id` for write access.

## Type definitions

`src/shared/types/database.types.ts` is hand-authored to exactly match the
migrations above (Supabase's generated-types format), with a note to
regenerate via `npm run db:types` once a live database exists.
`src/shared/types/domain.ts` layers ergonomic aliases (`Batch`,
`BatchOperation`, `BatchWithRelations`, ...) on top. `src/shared/types/api.ts`
defines the typed `ApiResult<T>` envelope every Route Handler / Server
Action will return. `src/shared/lib/validation/enums.ts` mirrors every
Postgres enum as a Zod schema — the single source of truth for both React
Hook Form validation and API-boundary validation.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase project URL/keys
supabase start                # local Postgres + Auth + Storage
supabase db reset             # applies all migrations + seed data
npm run db:types              # regenerate database.types.ts from the live schema
npm run dev
```

## Status

✅ Project structure · ✅ Database schema · ✅ Folder architecture ·
✅ Type definitions · ✅ Supabase configuration
⏳ Modules (Auth, Dashboard, Orders, Batches, Manufacturing, Inventory,
Gold Tracking, Employees, Reports, Analytics, Settings) — awaiting next
prompt, to be implemented module by module against this foundation.
