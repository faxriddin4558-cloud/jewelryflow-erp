import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  GOLDIA_FACTORY_CONFIG,
  FULL_PIPELINE_FACTORY_CONFIG,
  getActiveFactoryConfig,
  setActiveFactoryConfig,
  resetFactoryConfig,
  isStageActive,
  filterActiveStages,
  getNextActiveStage,
  getPreviousActiveStage,
  isDepartmentSlugActive,
  getActiveDepartmentSlugs,
  type FactoryConfig,
} from "@/lib/factory-config";
import {
  DEPARTMENT_ROUTE_CONFIG,
  getActiveDepartmentRoutes,
  isDepartmentRouteActive,
} from "@/modules/manufacturing/presentation/config/departments.config";

describe("FactoryConfig & Dynamic Route Advancer (Multi-Tenant & Goldia Profile)", () => {
  beforeEach(() => {
    resetFactoryConfig();
  });

  afterEach(() => {
    resetFactoryConfig();
  });

  describe("1. Goldia Factory Default Profile Constraints", () => {
    it("initializes with Goldia factory defaults and machinery parameters", () => {
      const config = getActiveFactoryConfig();
      expect(config).toEqual(GOLDIA_FACTORY_CONFIG);
      expect(config.factoryId).toBe("goldia");
      expect(config.laserMachinesCount).toBe(8);
      expect(config.castingMachinesCount).toBe(2);
      expect(config.workersCount).toBeGreaterThanOrEqual(30);
      expect(config.maxModelsPerBatch).toBe(20);
      expect(config.setsPerModel).toBe(10);
    });

    it("strictly disables Ponza (Pumice) and Zircon across codes, names, orders, and departments", () => {
      // Pumice variations
      expect(isStageActive({ code: "PUMICE" })).toBe(false);
      expect(isStageActive({ code: "PUMICE_MACHINE" })).toBe(false);
      expect(isStageActive({ name: "Pumice Machine" })).toBe(false);
      expect(isStageActive({ department: "Ponza" })).toBe(false);
      expect(isStageActive({ name: "9. Ponza uskunasi", stage_order: 9 })).toBe(false);

      // Zircon variations
      expect(isStageActive({ code: "ZIRCON" })).toBe(false);
      expect(isStageActive({ code: "ZIRCON_MACHINE" })).toBe(false);
      expect(isStageActive({ name: "Zircon Machine" })).toBe(false);
      expect(isStageActive({ department: "Zircon" })).toBe(false);
      expect(isStageActive({ name: "13. Zirkon o'rnatish", stage_order: 13 })).toBe(false);
    });

    it("keeps all active manufacturing stages enabled for Goldia", () => {
      expect(isStageActive({ code: "WAX", name: "Wax", stage_order: 1 })).toBe(true);
      expect(isStageActive({ code: "CASTING", name: "Casting", stage_order: 5 })).toBe(true);
      expect(isStageActive({ code: "SANDING", name: "Sanding", stage_order: 8 })).toBe(true);
      expect(isStageActive({ code: "PRE_POLISH", name: "Pre-Polish", stage_order: 11 })).toBe(true);
      expect(isStageActive({ code: "FINAL_POLISH", name: "Final Polish", stage_order: 15 })).toBe(true);
      expect(isStageActive({ code: "LASER", name: "Laser Decoration", stage_order: 16 })).toBe(true);
      expect(isStageActive({ code: "PACKAGING", name: "Packaging", stage_order: 19 })).toBe(true);
      expect(isStageActive({ code: "COMPLETED", name: "Completed", stage_order: 20 })).toBe(true);
    });
  });

  describe("2. Dynamic Route Advancer (Skipping Disabled Stages)", () => {
    const pipelineStages = [
      { stage_order: 7, name: "7. Straightening", department: "Straightening" },
      { stage_order: 8, name: "8. Sanding", department: "Sanding" },
      { stage_order: 9, name: "9. Pumice Machine", department: "Pumice", code: "PUMICE" },
      { stage_order: 10, name: "10. Cleaning 1", department: "Cleaning" },
      { stage_order: 11, name: "11. Pre-Polish Machine", department: "Pre-Polish" },
      { stage_order: 12, name: "12. Cleaning 2", department: "Cleaning" },
      { stage_order: 13, name: "13. Zircon Machine", department: "Zircon", code: "ZIRCON" },
      { stage_order: 14, name: "14. Cleaning 3", department: "Cleaning" },
      { stage_order: 15, name: "15. Final Polish", department: "Final Polish" },
      { stage_order: 16, name: "16. Laser Decoration", department: "Laser" },
      { stage_order: 25, name: "25. Tayyor mahsulot ombori", department: "Ombor" },
    ];

    it("advances from Sanding (8) skipping Pumice (9) directly to Cleaning 1 (10)", () => {
      const next = getNextActiveStage(8, pipelineStages);
      expect(next.stage_order).toBe(10);
      expect(next.name).toBe("10. Cleaning 1");
    });

    it("advances from Cleaning 2 (12) skipping Zircon (13) directly to Cleaning 3 (14)", () => {
      const next = getNextActiveStage(12, pipelineStages);
      expect(next.stage_order).toBe(14);
      expect(next.name).toBe("14. Cleaning 3");
    });

    it("advances past the last production stage into terminal warehouse (25)", () => {
      const next = getNextActiveStage(16, pipelineStages);
      expect(next.stage_order).toBe(25);
      expect(next.name).toContain("Tayyor mahsulot ombori");
    });

    it("correctly backtracks skipping disabled stages with getPreviousActiveStage", () => {
      // Previous active stage from Cleaning 1 (10) skips Pumice (9) back to Sanding (8)
      const prevFrom10 = getPreviousActiveStage(10, pipelineStages);
      expect(prevFrom10?.stage_order).toBe(8);

      // Previous active stage from Cleaning 3 (14) skips Zircon (13) back to Cleaning 2 (12)
      const prevFrom14 = getPreviousActiveStage(14, pipelineStages);
      expect(prevFrom14?.stage_order).toBe(12);
    });

    it("filters a list of stages to only include active ones", () => {
      const active = filterActiveStages(pipelineStages);
      expect(active.some((s) => s.stage_order === 9)).toBe(false);
      expect(active.some((s) => s.stage_order === 13)).toBe(false);
      expect(active.length).toBe(pipelineStages.length - 2);
    });
  });

  describe("3. Multi-Tenant SaaS Configurability", () => {
    it("dynamically enables all stages when configured for full-pipeline tenant", () => {
      setActiveFactoryConfig(FULL_PIPELINE_FACTORY_CONFIG);

      expect(isStageActive({ code: "PUMICE", stage_order: 9 })).toBe(true);
      expect(isStageActive({ code: "ZIRCON", stage_order: 13 })).toBe(true);

      const pipelineStages = [
        { stage_order: 8, name: "8. Sanding", department: "Sanding" },
        { stage_order: 9, name: "9. Pumice Machine", department: "Pumice", code: "PUMICE" },
        { stage_order: 10, name: "10. Cleaning 1", department: "Cleaning" },
      ];

      // Under full pipeline, stage 8 moves to stage 9 (Pumice is NOT skipped)
      const next = getNextActiveStage(8, pipelineStages);
      expect(next.stage_order).toBe(9);
      expect(next.name).toBe("9. Pumice Machine");
    });

    it("supports custom tenant profiles with custom skipped stages", () => {
      const customTenantConfig: FactoryConfig = {
        factoryId: "tenant-artisan",
        factoryName: "Artisan Studio",
        disabledStageCodes: ["LASER"],
        disabledStageOrders: [16],
        disabledDepartmentSlugs: ["laser-decoration"],
        laserMachinesCount: 0,
        castingMachinesCount: 1,
        workersCount: 5,
        maxModelsPerBatch: 5,
        setsPerModel: 2,
      };

      setActiveFactoryConfig(customTenantConfig);

      expect(isStageActive({ code: "LASER", stage_order: 16 })).toBe(false);
      expect(isStageActive({ code: "PUMICE", stage_order: 9 })).toBe(true);
      expect(isStageActive({ code: "ZIRCON", stage_order: 13 })).toBe(true);
    });
  });

  describe("4. Presentation Layer & Department Route Integration", () => {
    it("identifies disabled department slugs for Goldia factory", () => {
      expect(isDepartmentSlugActive("pumice")).toBe(false);
      expect(isDepartmentSlugActive("zircon")).toBe(false);
      expect(isDepartmentSlugActive("casting")).toBe(true);
      expect(isDepartmentSlugActive("laser-decoration")).toBe(true);
      expect(isDepartmentSlugActive("final-polish")).toBe(true);

      expect(isDepartmentRouteActive("pumice")).toBe(false);
      expect(isDepartmentRouteActive("zircon")).toBe(false);
      expect(isDepartmentRouteActive("casting")).toBe(true);

      const filtered = getActiveDepartmentSlugs(["pumice", "casting", "zircon", "wax-assembly"]);
      expect(filtered).toEqual(["casting", "wax-assembly"]);
    });

    it("filters active department routes for UI navigation", () => {
      const activeRoutes = getActiveDepartmentRoutes();
      const allRoutes = Object.keys(DEPARTMENT_ROUTE_CONFIG);

      // Goldia excludes pumice and zircon, so 15 - 2 = 13 routes active
      expect(allRoutes.length).toBe(15);
      expect(activeRoutes.length).toBe(13);

      expect(activeRoutes.some((r) => r.slug === "pumice")).toBe(false);
      expect(activeRoutes.some((r) => r.slug === "zircon")).toBe(false);
      expect(activeRoutes.some((r) => r.slug === "casting")).toBe(true);
      expect(activeRoutes.some((r) => r.slug === "laser-decoration")).toBe(true);
    });

    it("re-enables pumice and zircon routes when tenant switches to full pipeline", () => {
      setActiveFactoryConfig(FULL_PIPELINE_FACTORY_CONFIG);
      const activeRoutes = getActiveDepartmentRoutes();
      expect(activeRoutes.length).toBe(15);
      expect(activeRoutes.some((r) => r.slug === "pumice")).toBe(true);
      expect(activeRoutes.some((r) => r.slug === "zircon")).toBe(true);
    });
  });
});
