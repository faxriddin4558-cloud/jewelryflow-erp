// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScaleReader } from "../use-scale-reader";

describe("useScaleReader hook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with default disconnected state", () => {
    const { result } = renderHook(() => useScaleReader());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.reading).toBeNull();
    expect(result.current.liveWeight).toBe(0);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.isSupported).toBe("boolean");
  });

  it("connects to mock scale, receives weight, and disconnects", async () => {
    const { result } = renderHook(() => useScaleReader());

    await act(async () => {
      await result.current.connectMockScale(45.678);
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.liveWeight).toBe(45.678);
    expect(result.current.isStable).toBe(true);

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.reading).toBeNull();
  });
});
