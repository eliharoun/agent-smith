import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebounced } from "./use-debounced";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebounced", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounced("hello", 400));
    expect(result.current).toBe("hello");
  });

  it("does not update before the delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounced(value, 400),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe("a");
  });

  it("updates after the delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounced(value, 400),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).toBe("b");
  });

  it("resets timer on rapid successive changes", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounced(value, 400),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ value: "c" });
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe("a");
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe("c");
  });

  it("works with numeric values", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounced(value, 300),
      { initialProps: { value: 0 } },
    );
    rerender({ value: 42 });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(42);
  });
});
