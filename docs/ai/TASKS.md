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

- [VERIFIED] **TASK-005: High-Density Multi-Model Batch Support**
  - **Description:** Enhance batch data models to handle 15–20 models per batch, 10 sets per model (up to 200 items per batch) with item-level tracking and status.
  - **Files:** `src/lib/batch-density.ts`, `src/lib/__tests__/manufacturing-operations.test.ts`
  - **Acceptance Criteria:** Batch representation tracks model breakdown, set counts, individual weights, and distributes casting weight proportionally.

- [VERIFIED] **TASK-006: Partial Batch Handover & Two-Party Verification**
  - **Description:** Implement partial batch transfer logic allowing sets to advance independently between departments (e.g., casting to bench work, bench work to laser). Include sender weight dispatch and receiver weight confirmation with strict 0.05g tolerance and supervisor override.
  - **Files:** `src/lib/two-party-handover.ts`, `src/lib/__tests__/manufacturing-operations.test.ts`
  - **Acceptance Criteria:** Workers can send part of a batch. Receiver must confirm before WIP transitions. Discrepancies > 0.05g trigger DISCREPANCY_FLAGGED with supervisor override requirement.

- [VERIFIED] **TASK-007: Machine Queue & Allocation (8 Lasers, 2 Casting)**
  - **Description:** Implement station allocation for the 8 laser welders and 2 casting operators to optimize machine throughput and prevent bottlenecks.
  - **Files:** `src/lib/machine-queue.ts`, `src/lib/__tests__/manufacturing-operations.test.ts`
  - **Acceptance Criteria:** Batches and sub-batches can be assigned to specific machines (LASER-01 to LASER-08, CAST-01, CAST-02) with queue tracking and IDLE load balancing.

---

## Phase 2 & 3: Gold Accounting & Multi-Tenant SaaS (P1 & P2)

- [VERIFIED] **TASK-008: Precision Mass Balance & Gold Loss Hardening**
  - **Description:** Implement stage-by-stage mass balance validation across 585, 750, and 999 gold purities with stage-level tolerance alerting.
  - **Files:** `src/lib/erp-engine.ts`, `src/lib/__tests__/manufacturing-operations.test.ts`
  - **Acceptance Criteria:** Loss calculation checks input vs output + filings + dust, alerts EXCESSIVE_LOSS_ALERT on out-of-spec loss, verifies mass balance within 0.01g tolerance.

- [VERIFIED] **TASK-009: Multi-Tenant Architecture Foundation (`organization_id`)**
  - **Description:** Abstract factory configuration and operational data behind tenant ID (`organization_id`), preparing for SaaS rollout with RLS policies and initial Goldia tenant seed.
  - **Files:** `supabase/migrations/20260101000018_multi_tenant_factory_settings.sql`, `src/lib/__tests__/factory-config.test.ts`
  - **Acceptance Criteria:** Forward-only migration 018 creates organizations, organization_factory_settings, two_party_handovers, links nullable organization_id across batches/orders/inventory, enforces RLS, verified in test suite.

- [VERIFIED] **TASK-010: Multi-Tenant Tenant Isolation & Handover Atomic RPCs**
  - **Description:** Implement `public.current_organization_id()` helper, tenant-level RLS policies on batches, orders, inventory, batch_stage_wip, and two_party_handovers. Implement atomic database RPCs `rpc_dispatch_stage_handover`, `rpc_accept_stage_handover`, `rpc_override_stage_handover`.
  - **Files:** `supabase/migrations/20260101000019_tenant_isolation_and_handover_rpcs.sql`, `src/lib/__tests__/multi-tenant-security.test.ts`
  - **Acceptance Criteria:** Clean tenant isolation, multi-tenant contract tests pass, RPC signatures match client invocations.

- [VERIFIED] **TASK-011: Shopfloor Two-Party Handover Tab & Real-Time Verification UI**
  - **Description:** Integrate chain-of-custody dispatch into `rpc_move_partial_wip` workflow, create dedicated 🤝 Qabul/Topshirish tab in `BatchesPage` for physical weighing verification with 0.05g tolerance enforcement, flagging, and supervisor override.
  - **Files:** `src/app/batches/page.tsx`
  - **Acceptance Criteria:** Dispatched sub-batches appear in pending acceptance queue; receiver enters scale measurement; discrepancy > 0.05g halts flow; supervisor can override with documented reason.

