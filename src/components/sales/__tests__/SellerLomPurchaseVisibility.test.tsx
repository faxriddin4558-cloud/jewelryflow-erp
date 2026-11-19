// @vitest-environment happy-dom
// 091 UI: the bazaar LOM purchase section must render in the seller's Kassam tab wherever it is shown (the Kassam page
// and the sales home page's mobile workspace), exactly once, and for management on Kassa & Valyuta (seller chooser).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import type * as ErpEngineModule from "@/lib/erp-engine";

const role = vi.hoisted(() => ({ value: "sales" }));

function chain(): unknown {
  const result = { data: [], error: null, count: 0 };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, key) {
      if (key === "then") return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  };
  const proxy: unknown = new Proxy({}, handler);
  return proxy;
}
vi.mock("@/lib/erp-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof ErpEngineModule>();
  return {
    ...actual,
    RBAC: { ...actual.RBAC, getCurrentUser: () => ({ id: "u-1", role: role.value, name: "Test", organization_id: "o-1" }) },
    supabase: {
      from: vi.fn(() => chain()),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
      channel: vi.fn(() => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) })),
      removeChannel: vi.fn(),
    },
  };
});
vi.mock("@/lib/use-session-user", () => ({ useSessionUser: () => ({ id: "u-1", role: role.value, name: "Test" }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sales/app/kassam",
  useSearchParams: () => new URLSearchParams(),
}));

// the app compiles JSX with the automatic runtime; vitest uses the classic one -> React must be global for the imports
(globalThis as unknown as { React: typeof React }).React = React;
const TITLE = /Bozordan LOM xarid qilish/;

describe("091 UI — seller LOM purchase section visibility", () => {
  afterEach(() => cleanup());

  it("seller: /sales/app/kassam (menu 'Kassam') shows it exactly once, with the seller's own till form", async () => {
    role.value = "sales";
    const KassamPage = (await import("@/app/sales/app/kassam/page")).default;
    render(<KassamPage />);
    await waitFor(() => expect(screen.getAllByText(TITLE)).toHaveLength(1));
    expect(screen.getByTestId("lomx-submit")).toBeTruthy();
    expect(screen.queryByTestId("lomx-seller")).toBeNull(); // no seller chooser for a seller
  });

  it("seller: the full mobile workspace (sales home page) shows it in the 'Kassam' tab", async () => {
    role.value = "sales";
    const { SellerMobileWorkspace } = await import("../SellerMobileWorkspace");
    render(<SellerMobileWorkspace />);
    fireEvent.click(await screen.findByText(/🏦 Kassam/));
    await waitFor(() => expect(screen.getAllByText(TITLE)).toHaveLength(1));
  });

  it("management (manager = director): Kassa & Valyuta shows it with the seller chooser", async () => {
    for (const r of ["manager", "director"]) {
      role.value = r;
      const CashVaultPage = (await import("@/app/sales/app/cash/page")).default;
      render(<CashVaultPage />);
      await waitFor(() => expect(screen.getAllByText(TITLE)).toHaveLength(1));
      expect(screen.getByTestId("lomx-seller")).toBeTruthy();
      cleanup();
    }
  });
});
