// @vitest-environment happy-dom
// 090 UI: the manager -> factory goods return section must render in the factory tab of the management workspace
// (every route that shows that tab), once on /sales/app/factory, in "Barchasi" and "Zavodga topshirish" sub-views.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import type * as ErpEngineModule from "@/lib/erp-engine";

// a chainable Supabase stub: every query resolves to an empty result, rpc to null data
function chain(): unknown {
  const result = { data: [], error: null, count: 0 };
  const p: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, key) {
      if (key === "then") return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  };
  const proxy: unknown = new Proxy(p, handler);
  return proxy;
}
vi.mock("@/lib/erp-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof ErpEngineModule>();
  return {
    ...actual,
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sales/app/factory",
  useSearchParams: () => new URLSearchParams(),
}));

// the app compiles JSX with the automatic runtime; vitest uses the classic one -> React must be global for the imports
(globalThis as unknown as { React: typeof React }).React = React;
const load = async () => ({
  DirectorSalesWorkspace: (await import("../DirectorSalesWorkspace")).DirectorSalesWorkspace,
  FactoryLedgerPage: (await import("@/app/sales/app/factory/page")).default,
});

const TITLE = /Menejer omboridan zavodga tovar qaytarish/;

describe("090 UI — factory goods return section visibility", () => {
  afterEach(() => cleanup());
  it("/sales/app/factory (menu 'Zavod Bilan Hisob'): rendered exactly once, inside the factory tab", async () => {
    const { FactoryLedgerPage } = await load();
    render(<FactoryLedgerPage />);
    await waitFor(() => expect(screen.getAllByText(TITLE)).toHaveLength(1));
    expect(screen.getByTestId("fgr-submit")).toBeTruthy();
  });

  it("director panel / handovers route (factory tab, 'handover' sub-view): rendered", async () => {
    const { DirectorSalesWorkspace } = await load();
    render(<DirectorSalesWorkspace initialTab="factory" factorySection="handover" hideTopBanner hideTabBar />);
    await waitFor(() => expect(screen.getAllByText(TITLE)).toHaveLength(1));
  });

  it("'receive only' sub-view: not rendered (it belongs to the outgoing side)", async () => {
    const { DirectorSalesWorkspace } = await load();
    render(<DirectorSalesWorkspace initialTab="factory" factorySection="receive" hideTopBanner hideTabBar />);
    await waitFor(() => expect(screen.getByText(/Zavod Bilan Hisob-Kitob/)).toBeTruthy());
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
