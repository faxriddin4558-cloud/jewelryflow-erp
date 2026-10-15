# JewelryFlow ERP — Task Backlog & Execution Tracker

**Branch:** `dev/manufacturing-erp-saas`  
**Status Legend:**  
- `[TODO]` - Planned and ready for implementation  
- `[IN_PROGRESS]` - Currently being implemented  
- `[VERIFIED]` - Implemented, passed unit tests, typecheck, lint, and build  

---

## Phase 0: Factory Configuration & Dynamic Route Advancement (Immediate P0)

- [VERIFIED] **TASK-001: Factory Configuration Service (`src/lib/factory-config.ts`)**
  - **Description:** Implement central factory configuration logic. Define default active/disabled stages for current factory (Goldia: `PUMICE` and `ZIRCON` disabled). Provide dynamic resolver functions: `isStageActive`, `getNextActiveStage`, `getPreviousActiveStage`, `filterActiveStages`.
  - **Files:** `src/lib/factory-config.ts`
  - **Acceptance Criteria:** Default Goldia config disables Ponza and Zircon. Custom configs can enable or disable any stage. Clean fallback for unknown stages.

- [VERIFIED] **TASK-002: Dynamic Route Advancement in Batch Management (`src/app/batches/page.tsx`)**
  - **Description:** Eliminate hardcoded `fromSt + 1` stage advancement. Use `getNextActiveStage` to route directly from preceding active stage to subsequent active stage, bypassing Ponza and Zircon for Goldia.
  - **Files:** `src/app/batches/page.tsx`
  - **Acceptance Criteria:** Advancing from Polishing/Pre-Pumice automatically skips Pumice and lands on the next active stage. Stage back-tracking also skips disabled stages.

- [VERIFIED] **TASK-003: Department Navigation and Board Filtering**
  - **Description:** Update `src/modules/manufacturing/presentation/config/departments.config.ts` and manufacturing board components so that disabled departments (Ponza, Zircon) are hidden or marked inactive according to factory configuration.
  - **Files:** `src/modules/manufacturing/presentation/config/departments.config.ts`, `src/app/batches/page.tsx`
  - **Acceptance Criteria:** UI only shows active departments for the active factory profile, but supports rendering all when configured.

- [VERIFIED] **TASK-004: Unit & Regression Tests for Factory Config & Routing**
  - **Description:** Write comprehensive unit tests for dynamic routing, stage skipping, edge cases (first stage, last stage, all stages enabled, multiple skipped stages).
  - **Files:** `src/lib/__tests__/factory-config.test.ts`
  - **Acceptance Criteria:** 100% test pass on stage skipping and factory configuration defaults (45/45 total tests passing).

---

## Phase 1: High-Density Batch Execution & Two-Party Handover (P0)

- [TODO] **TASK-005: High-Density Multi-Model Batch Support**
  - **Description:** Enhance batch data models to handle 15–20 models per batch, 10 sets per model (up to 200 items per batch) with item-level tracking and status.
  - **Files:** `src/types/batch.ts`, `src/modules/manufacturing/domain/entities/batch.entity.ts`
  - **Acceptance Criteria:** Batch representation tracks model breakdown, set counts, and individual weights.

- [TODO] **TASK-006: Partial Batch Handover & Two-Party Verification**
  - **Description:** Implement partial batch transfer logic allowing sets to advance independently between departments (e.g., casting to bench work, bench work to laser). Include sender weight dispatch and receiver weight confirmation.
  - **Files:** `src/modules/manufacturing/domain/services/handover-service.ts`, `src/types/handover.ts`
  - **Acceptance Criteria:** Workers can send part of a batch. Receiver must confirm before WIP transitions. Discrepancies > 0.05g trigger warning.

- [TODO] **TASK-007: Machine Queue & Allocation (8 Lasers, 2 Casting)**
  - **Description:** Implement station allocation for the 8 laser welders and 2 casting operators to optimize machine throughput and prevent bottlenecks.
  - **Files:** `src/lib/machine-queue.ts`
  - **Acceptance Criteria:** Batches and sub-batches can be assigned to specific machines and operators with queue tracking.

---

## Phase 2 & 3: Gold Accounting & Multi-Tenant SaaS (P1 & P2)

- [TODO] **TASK-008: Precision Mass Balance & Gold Loss Hardening**
  - **Description:** Implement stage-by-stage mass balance validation across 585, 750, and 999 gold purities.
  - **Files:** `src/lib/erp-engine.ts`, `src/lib/gold-accounting.ts`
  - **Acceptance Criteria:** Loss calculation checks input vs output + filings + dust, alerts on out-of-spec loss.

- [TODO] **TASK-009: Multi-Tenant Architecture Foundation (`organization_id`)**
  - **Description:** Abstract factory configuration and operational data behind tenant ID (`organization_id`), preparing for SaaS rollout.
  - **Files:** `supabase/migrations/20260101000018_multi_tenant_factory_settings.sql`
  - **Acceptance Criteria:** Schema supports tenant-specific stage configuration and machine counts.
