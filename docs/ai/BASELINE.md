# JewelryFlow ERP — Baseline Architectural State

**Document Version:** 1.0.0
**Date:** 2026-10-15
**Branch:** `dev/manufacturing-erp-saas`
**Base Commit:** `4ddc0d0` (from `main`)
**Lead Architect:** Autonomous Development Lead

---

## 1. Executive Summary

JewelryFlow ERP is an integrated enterprise resource planning system tailored for precious metal (gold) jewelry manufacturing and distribution. This document establishes the foundational baseline of the application architecture, database schemas, test results, and operational parameters prior to our transformation into a production-grade jewelry manufacturing ERP with multi-tenant SaaS capabilities.

---

## 2. Technical Stack & Environment

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5.x (Strict Mode)
- **Database / Backend:** Supabase (PostgreSQL 15+), PostgREST, RLS
- **Authentication:** Supabase Auth (Cookie-based session via `@supabase/ssr`)
- **Styling & UI:** Tailwind CSS, Lucide React, Radix UI primitives
- **Testing:** Vitest / Jest-compatible test runner (`npm test`)
- **Package Manager:** npm

### Verification Baseline Status
- `npm test`: **32 / 32 passing**
- `npm run typecheck`: **0 errors**
- `npm run lint`: **0 errors**
- `npm run build`: **31 / 31 static/dynamic pages compiled successfully**

---

## 3. Database Schema & Data Conventions

The production database contains 43 public tables and over 230 functions. Crucially, the schema operates with a verified hybrid primary key architecture:

| Table | Primary Key | Key Foreign Keys / Identifier Columns | Notes |
| :--- | :--- | :--- | :--- |
| `batches` | `BIGINT` | `order_id` (BIGINT), `batch_no` (TEXT) | Production batch entity |
| `orders` | `BIGINT` | `customer_id` (UUID), `order_number` (TEXT) | Sales and custom manufacturing orders |
| `batch_stage_wip` | `UUID` | `batch_id` (TEXT), `stage_id` (INT) | Operational WIP record. `batch_id` stores string representation of `batches.id` or `batch_no` |
| `inventory_items` | `UUID` | `sku` (TEXT), `category` (TEXT) | Safe / raw metal / finished goods inventory |
| `profiles` | `UUID` | `user_id` (UUID references `auth.users`) | User profiles, role, tenant link |
| `production_stages` | `INT` / `UUID` | `stage_order` (INT), `code` (TEXT) | Sequential operational stages |

### Confirmed Administrative Access
- Primary Factory / Director Email: `admin@goldia.uz`
- Verified roles: `director`, `admin`, `manager`, `worker`

---

## 4. Manufacturing Workflow Architecture

Currently, the codebase exhibits two overlapping manufacturing workflow implementations:

1. **DDD Architecture (`src/modules/manufacturing/`):**
   - Domain entities: `Batch`, `BatchOperation`, `WorkflowStage`, `LossTracking`.
   - Application services: `workflow-advancer.ts`, `skip-operation.ts`, `handover-service.ts`.
   - Presentation config: `src/modules/manufacturing/presentation/config/departments.config.ts`.

2. **Operational Page Architecture (`src/app/batches/`, `src/app/employees/`):**
   - Directly interacts with `production_stages` and `batch_stage_wip`.
   - Linear stage advancement previously hardcoded: `stages.find(s => s.stage_order === fromSt + 1)`.
   - Does not dynamically skip inactive/disabled stages for specific factory profiles.

---

## 5. Factory Operational Profile (Goldia Factory)

- **Workers:** 30+ craftsmen and machine operators.
- **Machinery:** 8 laser machines, 2 casting (quyuv) machines.
- **Batch Complexity:** 15–20 models per batch, 10 sets per model (high-density multi-item batches).
- **Stage Exceptions for Goldia:**
  - **Ponza (`PUMICE` / pumice machine):** **DISABLED** (not used in our production process).
  - **Zircon processing (`ZIRCON` / zircon machine):** **DISABLED** (not used in our production process).
  - **Requirement:** Must be dynamically bypassed in all route advancement, department boards, and WIP transitions, while remaining configurable for other tenants.
