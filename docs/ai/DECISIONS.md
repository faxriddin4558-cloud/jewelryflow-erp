# JewelryFlow ERP — Architectural Decision Records (ADRs)

**Branch:** `dev/manufacturing-erp-saas`  
**Last Updated:** 2026-10-15  

---

## ADR-001: Factory-Specific Workflow Customization via Dynamic Route Advancer

### Context
In the physical factory (Goldia), certain standard jewelry manufacturing stages are not utilized. Specifically:
- **Ponza (Pumice machine / `PUMICE`)** is not part of Goldia's surface finishing process.
- **Zircon processing (Zircon machine / `ZIRCON`)** is not performed in-house on a dedicated machine.

In the original code (`src/app/batches/page.tsx` line 181), batch advancement was hardcoded to linear incrementation:
```typescript
const nextStage = stages.find(s => s.stage_order === fromSt + 1);
```
This caused batches to get stuck or erroneously route into inactive departments. Furthermore, future SaaS tenants may or may not use these machines.

### Decision
1. Introduce a centralized `FactoryConfig` service (`src/lib/factory-config.ts`) that defines the active and disabled stages for any given factory profile.
2. For Goldia (`admin@goldia.uz`), set `disabled_stage_codes: ['PUMICE', 'ZIRCON']` by default.
3. Replace linear `fromSt + 1` logic with dynamic route resolution:
   - `getNextActiveStage(currentStageOrder, stages, config)`
   - `getPreviousActiveStage(currentStageOrder, stages, config)`
   - `filterActiveStages(stages, config)`
4. Filter department views and Kanban boards so that inactive stages are hidden from factory workers by default, while maintaining full configurability for multi-tenant deployments.

### Consequences
- **Positive:** Batches seamlessly bypass Ponza and Zircon in Goldia without database corruption or manual workarounds.
- **Positive:** Multi-tenant SaaS architecture is preserved; other tenants can enable Pumice and Zircon simply by changing configuration.
- **Positive:** Existing unit tests remain green; new regression tests verify stage jumping behavior.

---

## ADR-002: Dual Architecture Alignment Strategy

### Context
The codebase contains both:
1. Modern Domain-Driven Design (DDD) in `src/modules/manufacturing/`
2. Direct-table operational views in `src/app/batches/`, `src/app/orders/`, and `src/app/employees/`

### Decision
Rather than doing a risky large-scale rewrite that could break working production workflows or introduce regressions:
- Unify the routing logic by extracting route resolution into a shared, pure TypeScript utility (`src/lib/factory-config.ts`).
- Consume this utility across both DDD services (`workflow-advancer.ts`, `departments.config.ts`) and App Router pages (`src/app/batches/page.tsx`).
- Preserve existing table structures and ID conventions (`batches.id` BIGINT, `batch_stage_wip.id` UUID, `batch_id` TEXT).
