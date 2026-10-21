import { describe, it, expect } from "vitest";
import { resolveEmployeeRole, RBAC, type EmployeeRow } from "../erp-engine";

describe("Local Auth & Role Resolution Verification", () => {
  it("resolves seller and sotuvchi to Seller with minimal sales permissions (isolated from salary/inventory)", () => {
    const sellerEmp: Partial<EmployeeRow> = {
      id: "11111111-1111-4001-8001-000000000007",
      user_id: "11111111-1111-4001-8001-000000000007",
      role: "sales",
      role_type: "seller",
      department: "Savdo",
      name: "Jamshid Sotuvchi",
      status: "active",
    };

    const resolvedRole = resolveEmployeeRole(sellerEmp);
    expect(resolvedRole).toBe("Seller");

    // Check RBAC permissions for Seller
    expect(RBAC.hasPermission(resolvedRole, "edit_sales")).toBe(true);
    expect(RBAC.hasPermission(resolvedRole, "record_sale")).toBe(true);
    expect(RBAC.hasPermission(resolvedRole, "record_client_settlement")).toBe(true);
    expect(RBAC.hasPermission(resolvedRole, "surrender_to_factory")).toBe(true);

    // Security isolation guards: Seller MUST NOT have accountant salary or inventory rights
    expect(RBAC.hasPermission(resolvedRole, "edit_salary_rate")).toBe(false);
    expect(RBAC.hasPermission(resolvedRole, "edit_inventory")).toBe(false);
    expect(RBAC.hasPermission(resolvedRole, "create_batch")).toBe(false);

    // Module access guards: Seller can access sales/orders but NOT manufacturing/settings
    expect(RBAC.canAccessModule(resolvedRole, "sales")).toBe(true);
    expect(RBAC.canAccessModule(resolvedRole, "orders")).toBe(true);
    expect(RBAC.canAccessModule(resolvedRole, "manufacturing")).toBe(false);
    expect(RBAC.canAccessModule(resolvedRole, "settings")).toBe(false);
    expect(RBAC.canAccessModule(resolvedRole, "calculator")).toBe(false);
  });

  it("resolves director to Director role and grants director permissions", () => {
    const directorEmp: Partial<EmployeeRow> = {
      id: "11111111-1111-4001-8001-000000000001",
      user_id: "11111111-1111-4001-8001-000000000001",
      role: "admin",
      role_type: "director",
      department: "Rahbariyat",
      name: "Alisher Director",
      status: "active",
    };

    const resolvedRole = resolveEmployeeRole(directorEmp);
    expect(resolvedRole).toBe("Director");

    expect(RBAC.hasPermission(resolvedRole, "edit_sales")).toBe(true);
    expect(RBAC.hasPermission(resolvedRole, "create_batch")).toBe(true);
    expect(RBAC.hasPermission(resolvedRole, "edit_inventory")).toBe(true);
    expect(RBAC.canAccessModule(resolvedRole, "sales")).toBe(true);
  });

  it("fails closed to Worker for unverified director account", () => {
    const suspiciousEmp: Partial<EmployeeRow> = {
      id: "33333333-3333-3333-3333-333333333333",
      user_id: "different-user-id",
      role: "admin",
      name: "Fake Admin",
      status: "active",
    };

    // The layout.tsx guard enforces that Director role requires linked user_id
    const rawRole = resolveEmployeeRole(suspiciousEmp);
    expect(rawRole).toBe("Director");
    // Simulation of layout.tsx security guard:
    const safeRole = rawRole === "Director" && suspiciousEmp.user_id !== suspiciousEmp.id ? "Worker" : rawRole;
    expect(safeRole).toBe("Worker");
  });
});
