// @vitest-environment happy-dom
// 092 UI: the old-sale return dialog works for a customer WITHOUT an opening debt (old part 0 -> new debt -> advance).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import type * as ErpEngineModule from "@/lib/erp-engine";

function chain(): unknown {
  const result = { data: [], error: null };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, key) {
      if (key === "then") return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      return () => proxy;
    },
  };
  const proxy: unknown = new Proxy({}, handler);
  return proxy;
}
vi.mock("@/lib/erp-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof ErpEngineModule>();
  return { ...actual, supabase: { from: vi.fn(() => chain()), rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) } };
});
(globalThis as unknown as { React: typeof React }).React = React;

describe("092 UI — old-sale return without an opening debt", () => {
  afterEach(() => cleanup());
  it("no opening debt documents: the dialog offers 585 / UZS / USD (585 selected) and does not refuse", async () => {
    const { OpeningSaleReturnModal } = await import("../OpeningSaleReturnModal");
    render(<OpeningSaleReturnModal customerId="c-1" customerName="Mijoz" onClose={() => {}} onDone={() => {}} />);
    const sel = (await screen.findByTestId("osr-unit")) as HTMLSelectElement;
    expect(sel.value).toBe("G585");
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["G585", "UZS", "USD"]);
    await waitFor(() => expect(screen.getByTestId("osr-weight")).toBeTruthy());
    expect(screen.queryByText(/vozvrat yozib bo/)).toBeNull();
  });
});
